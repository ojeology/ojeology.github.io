import type { BackendFile } from "./catalog_core";

export const API_FILES: BackendFile[] = [
  {
    path: "app/api/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/api/v1/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/providers/registry.py",
    language: "python",
    code: `"""Build the provider registry from configuration.

Every adapter is registered even without credentials — asking the
service for an unconfigured provider produces a clear, normalized
PROVIDER_NOT_CONFIGURED error instead of a silent failure.
"""
from __future__ import annotations

from app.config import Settings
from app.providers.base import ImageProvider
from app.providers.flux_provider import FluxProvider
from app.providers.gemini_provider import GeminiProvider
from app.providers.mock_provider import MockProvider
from app.providers.openai_provider import OpenAIProvider
from app.providers.stability_provider import StabilityProvider


def build_providers(settings: Settings) -> dict[str, ImageProvider]:
    return {
        "mock": MockProvider(),
        "gemini": GeminiProvider(settings.gemini_api_key, settings.provider_timeout_seconds),
        "openai": OpenAIProvider(settings.openai_api_key, settings.provider_timeout_seconds),
        "stability": StabilityProvider(settings.stability_api_key, settings.provider_timeout_seconds),
        "flux": FluxProvider(settings.bfl_api_key, settings.provider_timeout_seconds),
    }
`,
  },
  {
    path: "app/api/v1/characters.py",
    language: "python",
    code: `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import CharacterModel
from app.schemas import CharacterIn, CharacterOut

router = APIRouter(prefix="/characters", tags=["characters"])


@router.get("", response_model=list[CharacterOut])
async def list_characters(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(CharacterModel).order_by(CharacterModel.name))
    return result.scalars().all()


@router.post("", response_model=CharacterOut, status_code=201)
async def create_character(payload: CharacterIn, session: AsyncSession = Depends(get_session)):
    # fictional=True is enforced by the engine — character identity is
    # always an original creation, never a real-world person.
    char = CharacterModel(**payload.model_dump(), fictional=True)
    session.add(char)
    await session.commit()
    await session.refresh(char)
    return char


@router.get("/{character_id}", response_model=CharacterOut)
async def get_character(character_id: str, session: AsyncSession = Depends(get_session)):
    char = await session.get(CharacterModel, character_id)
    if not char:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Character not found.", "retryable": False}})
    return char


@router.patch("/{character_id}", response_model=CharacterOut)
async def update_character(character_id: str, payload: CharacterIn, session: AsyncSession = Depends(get_session)):
    char = await session.get(CharacterModel, character_id)
    if not char:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Character not found.", "retryable": False}})
    for key, value in payload.model_dump().items():
        setattr(char, key, value)
    char.version += 1  # bible edits are versioned — panels pin a version
    await session.commit()
    await session.refresh(char)
    return char
`,
  },
  {
    path: "app/api/v1/teams.py",
    language: "python",
    code: `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import TeamModel
from app.schemas import TeamIn, TeamOut

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
async def list_teams(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(TeamModel).order_by(TeamModel.name))
    return result.scalars().all()


@router.post("", response_model=TeamOut, status_code=201)
async def create_team(payload: TeamIn, session: AsyncSession = Depends(get_session)):
    team = TeamModel(**payload.model_dump())
    session.add(team)
    await session.commit()
    await session.refresh(team)
    return team


@router.get("/{team_id}", response_model=TeamOut)
async def get_team(team_id: str, session: AsyncSession = Depends(get_session)):
    team = await session.get(TeamModel, team_id)
    if not team:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Team not found.", "retryable": False}})
    return team
`,
  },
  {
    path: "app/api/v1/styles.py",
    language: "python",
    code: `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import StyleModel
from app.schemas import StyleIn, StyleOut

router = APIRouter(prefix="/styles", tags=["styles"])


@router.get("", response_model=list[StyleOut])
async def list_styles(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(StyleModel).order_by(StyleModel.id))
    return result.scalars().all()


@router.post("", response_model=StyleOut, status_code=201)
async def create_style(payload: StyleIn, session: AsyncSession = Depends(get_session)):
    existing = await session.get(StyleModel, payload.id)
    if existing:
        raise HTTPException(409, detail={"error": {"code": "CONFLICT", "message": f"Style '{payload.id}' already exists.", "retryable": False}})
    style = StyleModel(**payload.model_dump())
    session.add(style)
    await session.commit()
    await session.refresh(style)
    return style


@router.get("/{style_id}", response_model=StyleOut)
async def get_style(style_id: str, session: AsyncSession = Depends(get_session)):
    style = await session.get(StyleModel, style_id)
    if not style:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Style not found.", "retryable": False}})
    return style
`,
  },
  {
    path: "app/api/v1/projects.py",
    language: "python",
    code: `from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import PanelModel, ProjectModel
from app.schemas import GenerationOut, PanelIn, PanelOut, ProjectIn, ProjectOut, GenerateRequest
from app.services import continuity_service, generation_service

router = APIRouter(prefix="/projects", tags=["projects"])


def _queue(request: Request):
    return request.app.state.queue


@router.get("", response_model=list[ProjectOut])
async def list_projects(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(ProjectModel).order_by(ProjectModel.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(payload: ProjectIn, session: AsyncSession = Depends(get_session)):
    project = ProjectModel(**payload.model_dump())
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)):
    project = await session.get(ProjectModel, project_id)
    if not project:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Project not found.", "retryable": False}})
    return project


# ---------- panels ----------

@router.get("/{project_id}/panels", response_model=list[PanelOut])
async def list_panels(project_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(PanelModel).where(PanelModel.project_id == project_id).order_by(PanelModel.number)
    )
    return result.scalars().all()


@router.post("/{project_id}/panels", response_model=PanelOut, status_code=201)
async def create_panel(project_id: str, payload: PanelIn, session: AsyncSession = Depends(get_session)):
    if not await session.get(ProjectModel, project_id):
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Project not found.", "retryable": False}})
    panel = PanelModel(
        project_id=project_id,
        **payload.model_dump(mode="json"),
    )
    session.add(panel)
    await session.commit()
    await session.refresh(panel)
    return panel


@router.get("/{project_id}/panels/{panel_id}", response_model=PanelOut)
async def get_panel(project_id: str, panel_id: str, session: AsyncSession = Depends(get_session)):
    panel = await session.get(PanelModel, panel_id)
    if not panel or panel.project_id != project_id:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Panel not found.", "retryable": False}})
    return panel


@router.get("/{project_id}/panels/{panel_id}/continuity")
async def panel_continuity(project_id: str, panel_id: str, session: AsyncSession = Depends(get_session)):
    panel = await session.get(PanelModel, panel_id)
    if not panel or panel.project_id != project_id:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Panel not found.", "retryable": False}})
    summaries = await continuity_service.previous_panel_summaries(session, project_id, panel.number)
    refs = await continuity_service.reference_images(session, project_id, panel.number, panel.character_ids)
    return {"panel_id": panel_id, "continuity": summaries, "reference_images": refs}


# ---------- the headline endpoint ----------

@router.post("/{project_id}/panels/{panel_id}/generate", response_model=GenerationOut, status_code=202)
async def generate_panel(
    project_id: str,
    panel_id: str,
    payload: GenerateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Load context -> compose prompt -> select provider -> enqueue job.

    Returns 202 with the queued generation; poll GET /generations/{id}.
    """
    job = await generation_service.create_generation_job(
        session, _queue(request), project_id, panel_id, payload.provider, seed=payload.seed,
        extra_negative=payload.extra_negative,
    )
    return job
`,
  },
  {
    path: "app/api/v1/prompts.py",
    language: "python",
    code: `from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas import PreviewRequest, PreviewResponse
from app.services import generation_service

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.post("/preview", response_model=PreviewResponse)
async def prompt_preview(payload: PreviewRequest, session: AsyncSession = Depends(get_session)):
    """Inspect the exact prompt the engine would send — before spending
    a single render credit. Critical for debugging and prompt QA."""
    return await generation_service.preview_prompt(
        session, payload.project_id, payload.panel_id, payload.prompt_override, payload.style_override
    )
`,
  },
  {
    path: "app/api/v1/generations.py",
    language: "python",
    code: `from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import GenerationModel
from app.schemas import BatchGenerateRequest, GenerationOut, RegenerateRequest
from app.services import generation_service

router = APIRouter(prefix="/generations", tags=["generations"])


def _queue(request: Request):
    return request.app.state.queue


@router.get("", response_model=list[GenerationOut])
async def history(
    project_id: str | None = None,
    panel_id: str | None = None,
    status: str | None = None,
    provider: str | None = None,
    created_after: datetime | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """Searchable generation history: project, panel, prompt, provider,
    timing, status and final image."""
    return await generation_service.list_generations(
        session, project_id, panel_id, status, provider, created_after, limit, offset
    )


@router.post("/batch", status_code=202)
async def batch(payload: BatchGenerateRequest, request: Request, session: AsyncSession = Depends(get_session)):
    jobs = await generation_service.batch_generate(
        session, _queue(request), payload.project_id, payload.panel_ids, payload.provider
    )
    return {"queued": [j.id for j in jobs], "count": len(jobs), "concurrency": _queue(request)._concurrency}


@router.get("/{generation_id}", response_model=GenerationOut)
async def get_generation(generation_id: str, session: AsyncSession = Depends(get_session)):
    job = await session.get(GenerationModel, generation_id)
    if not job:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Generation not found.", "retryable": False}})
    return job


@router.post("/{generation_id}/regenerate", response_model=GenerationOut, status_code=202)
async def regenerate(generation_id: str, payload: RegenerateRequest, request: Request, session: AsyncSession = Depends(get_session)):
    """Re-run with the original context unless overrides are supplied.
    Seed is rejected up front if the provider can't honor it."""
    return await generation_service.regenerate(
        session, _queue(request), generation_id, payload.prompt_override, payload.style_override, payload.seed
    )


@router.post("/{generation_id}/cancel", response_model=GenerationOut)
async def cancel(generation_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    job = await session.get(GenerationModel, generation_id)
    if not job:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Generation not found.", "retryable": False}})
    if job.status in ("completed", "failed"):
        raise HTTPException(409, detail={"error": {"code": "ALREADY_FINISHED", "message": f"Generation is already {job.status}.", "retryable": False}})
    job.status = "cancelled"
    await _queue(request).cancel(generation_id)
    await session.commit()
    await session.refresh(job)
    return job
`,
  },
  {
    path: "app/api/v1/providers.py",
    language: "python",
    code: `from fastapi import APIRouter, Request

from app.config import get_settings

router = APIRouter(prefix="/providers", tags=["providers"])


@router.get("")
async def list_providers(request: Request):
    """Every registered adapter, its capabilities, and whether a server
    credential is configured. Choose honestly, render anywhere."""
    providers = request.app.state.providers
    return {
        "default": get_settings().default_provider,
        "providers": [p.info() for p in providers.values()],
    }
`,
  },
  {
    path: "app/main.py",
    language: "python",
    code: `"""BRYME Image Engine — application factory.

Lifespan boots: database -> demo seed -> storage -> provider registry
-> job queue. Every provider failure leaves as a normalized error body.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import characters, editor, generations, motion, projects, prompts, providers as providers_api, styles, teams
from app.config import get_settings
from app.db import SessionLocal, init_db
from app.models_motion import MotionProjectModel, RenderJobModel  # noqa: F401 — register tables
from app.motion.motion_service import run_render
from app.providers.base import ProviderError
from app.providers.registry import build_providers
from app.services.generation_service import run_generation
from app.storage.base import build_storage
from app.tts.base import TTSError
from app.tts.service import build_tts_providers
from app.workers.queue import GenerationQueue

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    if settings.seed_demo:
        from app.seed import seed_demo_data
        from app.seed_motion import seed_motion_demo
        await seed_demo_data(SessionLocal)
        await seed_motion_demo(SessionLocal)

    storage = build_storage()
    providers = build_providers(settings)
    tts_providers = build_tts_providers(settings)

    async def process(job_id: str) -> None:
        await run_generation(SessionLocal, storage, providers, job_id)

    queue = GenerationQueue(process, providers, concurrency=settings.queue_concurrency)
    await queue.start()

    # video rendering gets its own low-concurrency pool: ffmpeg is
    # CPU-bound and must never starve image generation.
    async def process_render(job_id: str) -> None:
        async with SessionLocal() as session:
            job = await session.get(RenderJobModel, job_id)
            if job is None or job.status == "cancelled":
                return
            project = await session.get(MotionProjectModel, job.motion_project_id)
            if project is None:
                return
            await run_render(session, storage, project, job)

    render_queue = GenerationQueue(process_render, providers, concurrency=settings.render_concurrency)
    await render_queue.start()

    app.state.settings = settings
    app.state.storage = storage
    app.state.providers = providers
    app.state.tts_providers = tts_providers
    app.state.queue = queue
    app.state.render_queue = render_queue
    logging.getLogger("bryme").info(
        "engine up — image: %s · voice: %s", settings.default_provider, settings.default_tts_provider
    )
    yield
    await queue.stop()
    await render_queue.stop()


app = FastAPI(
    title="BRYME Image Engine",
    version="1.0.0",
    description="Structured AI comic-generation engine. The provider is only the renderer.",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_dir = Path(settings.storage_dir)
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static/images", StaticFiles(directory=static_dir), name="images")

for module in (characters, teams, styles, projects, prompts, generations, providers_api, motion):
    app.include_router(module.router, prefix=settings.api_prefix)
# motion + editor each ship several routers from one module
app.include_router(motion.voices_router, prefix=settings.api_prefix)
app.include_router(motion.dialogue_router, prefix=settings.api_prefix)
app.include_router(editor.router, prefix=settings.api_prefix)
app.include_router(editor.images_router, prefix=settings.api_prefix)
app.include_router(editor.bible_router, prefix=settings.api_prefix)


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "service": "bryme-image-engine"}


# ---------- normalized error boundary ----------

@app.exception_handler(ProviderError)
async def provider_error_handler(_: Request, exc: ProviderError):
    logging.getLogger("bryme").warning("provider error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.http_status, content=exc.body())


@app.exception_handler(TTSError)
async def tts_error_handler(_: Request, exc: TTSError):
    logging.getLogger("bryme").warning("tts error %s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.http_status, content=exc.body())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "MALFORMED_REQUEST",
                "message": "Request failed schema validation.",
                "retryable": False,
                "details": [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()][:10],
            }
        },
    )
`,
  },
  {
    path: "app/seed.py",
    language: "python",
    code: `"""Demo match-day seed — Section 25 of the spec, runnable out of the box.

Project: Manchester City vs Bournemouth (fictional portrayal: original
kits, original characters, no official IP). 2 teams, 3 characters,
1 style, 5 panels including the 90+1' winner.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import CharacterModel, PanelModel, ProjectModel, StyleModel, TeamModel

log = logging.getLogger("bryme.seed")

STYLE = dict(
    id="bryme-football-v1",
    name="BRYME Football — Cinematic Satire Comic",
    description="cinematic football satire comic with a premium animated-film appearance",
    characteristics=[
        "premium animated-film appearance", "expressive faces",
        "exaggerated but believable reactions", "professional footballer anatomy",
        "dramatic stadium lighting", "detailed crowds", "cinematic camera angles",
        "rich environmental detail", "consistent character proportions", "original cartoon artwork",
    ],
    prompt_fragment=(
        "cinematic football satire comic panel, premium animated-film appearance, expressive faces, "
        "exaggerated but believable reactions, professional footballer anatomy, dramatic stadium lighting, "
        "detailed crowds, cinematic camera angle, rich environmental detail, consistent character proportions, "
        "original cartoon artwork"
    ),
    negative_prompt=(
        "photograph, broadcast screenshot, official club badge, sponsor logo, copyrighted artwork, "
        "copied illustration, watermark, distorted anatomy, duplicate player, extra limbs, malformed hands, "
        "unreadable text, inconsistent uniform, random character change"
    ),
)

TEAMS = [
    dict(
        id="city", name="Manchester City",
        colors=["sky blue", "white"], secondary_colors=["navy", "silver"],
        kit="original sky-blue football kit with white trim, plain shirt with no badge and no sponsor marks",
        manager_character="city-manager",
        stadium="vast modern floodlit arena with steep stands and a glowing night atmosphere",
        supporter_style="wall of sky-blue flags and bouncing chanting fans under floodlights",
        identity_notes="Palette and atmosphere only — never reproduce crests, sponsors or stadium branding.",
        reference_images=[],
    ),
    dict(
        id="bournemouth", name="Bournemouth",
        colors=["crimson red", "black"], secondary_colors=["white"],
        kit="original crimson-red and black vertically striped football kit, plain shirt with no badge and no sponsor marks",
        stadium="vast modern floodlit arena with steep stands and a glowing night atmosphere",
        supporter_style="compact, loud travelling end waving red and black scarves",
        identity_notes="Palette and atmosphere only — never reproduce crests, sponsors or stadium branding.",
        reference_images=[],
    ),
]

CHARACTERS = [
    dict(
        id="city-creative-midfielder", name="Creative Midfielder", team_id="city",
        role="attacking midfielder — the conductor",
        description="fictional athletic footballer in his prime, lean whippet build, always half-smiling like he knows the pass before you do",
        hair="short dark coily hair with a crisp hairline",
        face="warm brown skin, high cheekbones, expressive arched eyebrows, playful confident smirk",
        body="lean athletic build, low center of gravity, light on his feet",
        age_appearance="mid-twenties",
        expression="confident trademark smirk, eyebrows raised when he beats a man",
        kit=TEAMS[0]["kit"],
        personality="confident, playful, technically gifted, chief banter officer",
        visual_style="bryme-football-v1",
        reference_images=[],
        negative=["real player likeness", "photograph", "facial tattoo", "long hair"],
    ),
    dict(
        id="city-defender-01", name="Towering Centre-Back", team_id="city",
        role="centre-back — the wall that scores winners",
        description="fictional imposing centre-back, broad-shouldered and surprisingly elegant on the ball, arrives unmarked at the back post in stoppage time",
        hair="short cropped dark hair",
        face="sharp jawline, intense focused eyes that soften into a huge grin when he scores",
        body="tall, powerful shoulders, long stride",
        age_appearance="late twenties",
        expression="war-face in duels, absolute euphoria in celebration",
        kit=TEAMS[0]["kit"],
        personality="calm, decisive, secretly loves a last-minute winner",
        visual_style="bryme-football-v1",
        reference_images=[],
        negative=["real player likeness", "photograph", "blond hair", "headband"],
    ),
    dict(
        id="bou-keeper-01", name="Shot-Stopper Keeper", team_id="bournemouth",
        role="goalkeeper — having the game of his life",
        description="fictional elastic goalkeeper with ridiculous reflexes, single-handedly keeping the away side alive until the 91st minute",
        hair="tight buzz cut",
        face="narrow eyes locked on the ball, mouth open mid-shout organising his wall",
        body="wiry, explosive, hyper-extended diving posture",
        age_appearance="early thirties",
        expression="defiant glare after every save",
        kit=TEAMS[1]["kit"],
        personality="stubborn, heroic, increasingly exhausted",
        visual_style="bryme-football-v1",
        reference_images=[],
        negative=["real player likeness", "photograph", "gloves branding", "cap"],
    ),
]

PANELS = [
    dict(
        id="panel-01", number=1, title="Coin Toss Theatre",
        scene="pre-match coin toss under a wall of floodlights, both captains leaning in, the away end a red-and-black mosaic",
        event={"minute": "0", "type": "kickoff", "team": "Manchester City"},
        dialogue=[
            {"speaker": "Narrator", "text": "Ninety minutes. Two teams. One storyline.", "kind": "narration"},
            {"speaker": "City Captain", "text": "Make we just start this thing abeg.", "kind": "speech", "language": "Nigerian Pidgin"},
        ],
        character_ids=["city-creative-midfielder", "bou-keeper-01"],
    ),
    dict(
        id="panel-07", number=7, title="The Save of His Life",
        scene="a stonewall penalty in the 34th minute — and the keeper goes full horizontal to claw it out of the bottom corner",
        event={"minute": "34", "type": "save", "team": "Bournemouth", "player": "Shot-Stopper Keeper"},
        dialogue=[
            {"speaker": "Keeper", "text": "NOT TODAY! You hear me?! NOT TODAY!", "kind": "speech"},
            {"speaker": "Commentator", "text": "That is simply outrageous goalkeeping.", "kind": "commentary"},
        ],
        character_ids=["bou-keeper-01", "city-creative-midfielder"],
    ),
    dict(
        id="panel-12", number=12, title="VAR Kwaranta",
        scene="a handball shout, a finger to the earpiece, and twenty-two players losing their minds at once",
        event={"minute": "58", "type": "var", "team": "Manchester City", "player": "Creative Midfielder"},
        dialogue=[
            {"speaker": "City Midfielder", "text": "Ref abeg, na handball! Everybody see am!", "kind": "speech", "language": "Nigerian Pidgin"},
            {"speaker": "Crowd", "text": "V! A! R! V! A! R!", "kind": "crowd"},
        ],
        character_ids=["city-creative-midfielder", "bou-keeper-01"],
    ),
    dict(
        id="panel-20", number=20, title="90+1 — The Winner",
        scene="stoppage-time winner — a corner whipped in, the towering centre-back arrives unmarked and detonates a volley into the top corner",
        event={
            "minute": "90+1", "type": "goal", "team": "Manchester City",
            "player": "Towering Centre-Back", "assist": "Creative Midfielder", "detail": "top corner",
        },
        dialogue=[
            {"speaker": "City Player", "text": "Omo, we don win am!", "kind": "speech", "language": "Nigerian Pidgin"},
            {"speaker": "Commentator", "text": "At the DEATH! The champions-elect! Unbelievable scenes!", "kind": "commentary"},
        ],
        character_ids=["city-defender-01", "city-creative-midfielder", "bou-keeper-01"],
    ),
    dict(
        id="panel-21", number=21, title="Limbs in the Away End",
        scene="the away end detonates — strangers on strangers' shoulders, scarves everywhere, one steward quietly smiling",
        event={"minute": "90+2", "type": "crowd_reaction", "team": "Manchester City"},
        dialogue=[{"speaker": "Crowd", "text": "WE GO WIN AM! WE GO WIN AM!", "kind": "crowd", "language": "Nigerian Pidgin"}],
        character_ids=[],
    ),
]


async def seed_demo_data(session_factory: async_sessionmaker) -> None:
    async with session_factory() as session:
        if await session.get(ProjectModel, "proj-city-bou"):
            return

        session.add(StyleModel(**STYLE))
        for t in TEAMS:
            session.add(TeamModel(**t))
        for c in CHARACTERS:
            session.add(CharacterModel(**c, fictional=True, version=1))
        session.add(
            ProjectModel(
                id="proj-city-bou",
                name="Manchester City vs Bournemouth",
                match="Premier League — Matchday 12",
                style_id=STYLE["id"],
                team_ids=[t["id"] for t in TEAMS],
                character_ids=[c["id"] for c in CHARACTERS],
                meta={"scoreline": "1–0 · 90+1'", "panels_planned": 26},
            )
        )
        for p in PANELS:
            session.add(PanelModel(project_id="proj-city-bou", aspect_ratio="16:9", **p))

        await session.commit()
        log.info("demo seed complete — proj-city-bou with %s panels", len(PANELS))
`,
  },
  {
    path: "migrations/alembic.ini",
    language: "toml",
    code: `[alembic]
script_location = migrations
sqlalchemy.url = sqlite+aiosqlite:///./bryme.db
; prod: postgresql+asyncpg://bryme:bryme@db:5432/bryme
`,
  },
  {
    path: "migrations/env.py",
    language: "python",
    code: `"""Alembic environment — autogenerate from BRYME model metadata.

    alembic revision --autogenerate -m "add panels"
    alembic upgrade head
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db import Base
from app import models  # noqa: F401 — register all tables

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
`,
  },
  {
    path: "tests/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "tests/test_engine.py",
    language: "python",
    code: `"""Engine test suite.

Provider HTTP APIs are mocked with respx — no paid call is ever made.
Run: pytest -q
"""
from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
import respx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.providers.base import ProviderError
from app.providers.mock_provider import MockProvider
from app.providers.openai_provider import OpenAIProvider
from app.schemas import MatchEvent, PanelIn
from app.services import generation_service
from app.services.prompt_engine import composer
from app.storage.local import LocalStorage


# ------------------------------------------------ fixtures ----------

@pytest_asyncio.fixture
async def session_factory(tmp_path):
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    from app.seed import seed_demo_data
    await seed_demo_data(factory)
    yield factory
    await engine.dispose()


class FakeQueue:
    """enqueue() is the only contract the service needs."""
    def __init__(self, providers):
        self.providers = providers
        self.enqueued: list[str] = []

    async def enqueue(self, job_id: str):
        self.enqueued.append(job_id)


@pytest_asyncio.fixture
async def storage(tmp_path):
    return LocalStorage(str(tmp_path / "images"), "http://test/static/images")


# ------------------------------------------------ schema validation ----------

def test_minute_validator_rejects_garbage():
    with pytest.raises(Exception):
        MatchEvent(minute="abc", type="goal", team="City")


def test_minute_validator_accepts_stoppage():
    e = MatchEvent(minute="90+1", type="goal", team="City")
    assert e.minute == "90+1"


def test_aspect_ratio_validator():
    with pytest.raises(Exception):
        PanelIn(number=1, aspect_ratio="2:1")


# ------------------------------------------------ prompt engine ----

class _Style:
    prompt_fragment = "cinematic football satire comic panel"
    negative_prompt = "blurry"


class _Char:
    id = "city-creative-midfielder"
    name = "Creative Midfielder"
    role = "midfielder"
    description = "lean playful playmaker"
    hair = "short dark coily hair"
    face = "confident smirk"
    body = "lean build"
    age_appearance = "mid-twenties"
    kit = "original sky-blue kit"
    negative = ["real player likeness", "long hair"]


class _Team:
    id = "city"
    name = "Manchester City"
    kit = "original sky-blue kit with white trim"
    stadium = "floodlit arena"


def test_composer_layers_present():
    out = composer.compose(
        style=_Style(), characters=[_Char()], teams=[_Team()],
        scene="stoppage-time winner",
        event=MatchEvent(minute="90+1", type="goal", team="City", player="Towering Centre-Back", assist="Creative Midfielder"),
        dialogue=[],
    )
    for fragment in ("cinematic football satire", "Creative Midfielder", "sky-blue", "Scene: stoppage-time winner", "90+1", "Camera:", "Rules:"):
        assert fragment in out.prompt


def test_composer_dialogue_preserved_verbatim():
    from app.schemas import DialogueEntry
    pidgin = "Omo, we don win am!"
    out = composer.compose(
        style=_Style(), characters=[_Char()], teams=[_Team()], scene="winner",
        dialogue=[DialogueEntry(speaker="City Player", text=pidgin, kind="speech", language="Nigerian Pidgin")],
    )
    assert pidgin in out.prompt
    assert "preserved verbatim" in out.prompt


def test_negative_engine_dedupes_and_extends():
    out = composer.compose(
        style=_Style(), characters=[_Char()], teams=[_Team()], scene="x",
        extra_negative=["motion smear"],
    )
    n = out.negative_prompt
    for term in ("photograph", "sponsor logo", "malformed hands", "real player likeness", "motion smear"):
        assert term in n
    assert n.count("real player likeness") == 1


# ------------------------------------------------ providers ----

@pytest.mark.asyncio
async def test_mock_provider_deterministic_and_seeded():
    p = MockProvider(latency=0)
    a = await p.generate(prompt="hello comic", seed=42)
    b = await p.generate(prompt="hello comic", seed=42)
    assert a.seed == 42 and b.seed == 42
    assert a.image_bytes[0].startswith(b"<svg")
    assert a.image_bytes[0] == b.image_bytes[0]


@pytest.mark.asyncio
@respx.mock
async def test_openai_rate_limit_normalized():
    respx.post("https://api.openai.com/v1/images/generations").mock(
        return_value=httpx.Response(429, headers={"retry-after": "7"}, json={"error": {"message": "slow down"}})
    )
    p = OpenAIProvider(api_key="sk-test")
    with pytest.raises(ProviderError) as exc:
        await p.generate(prompt="anything")
    assert exc.value.code == "PROVIDER_RATE_LIMIT"
    assert exc.value.retryable is True
    assert exc.value.http_status == 429


@pytest.mark.asyncio
@respx.mock
async def test_openai_rejected_prompt_normalized():
    respx.post("https://api.openai.com/v1/images/generations").mock(
        return_value=httpx.Response(400, json={"error": {"message": "content policy"}})
    )
    p = OpenAIProvider(api_key="sk-test")
    with pytest.raises(ProviderError) as exc:
        await p.generate(prompt="bad")
    assert exc.value.code == "PROVIDER_INVALID_PROMPT"
    assert exc.value.retryable is False


@pytest.mark.asyncio
async def test_unconfigured_provider_fails_loudly(session_factory):
    from app.providers.base import ImageProvider, ProviderCapabilities  # noqa
    async with session_factory() as session:
        q = FakeQueue({"mock": MockProvider(latency=0)})
        with pytest.raises(ProviderError) as exc:
            await generation_service.create_generation_job(
                session, q, "proj-city-bou", "panel-20", provider_name="openai"
            )
        assert exc.value.code == "PROVIDER_NOT_CONFIGURED"


# ------------------------------------------------ storage ----

@pytest.mark.asyncio
async def test_storage_roundtrip(storage):
    stored = await storage.save(b"png-bytes", "png")
    assert stored.url.endswith(stored.key)
    assert stored.size_bytes == 9
    await storage.delete(stored.key)


# ------------------------------------------------ full pipeline ----

@pytest.mark.asyncio
async def test_create_job_composes_and_enqueues(session_factory):
    providers = {"mock": MockProvider(latency=0)}
    async with session_factory() as session:
        q = FakeQueue(providers)
        job = await generation_service.create_generation_job(
            session, q, "proj-city-bou", "panel-20", provider_name="mock"
        )
        assert job.status == "queued"
        assert "Towering Centre-Back" in job.prompt
        assert "sponsor logo" in job.negative_prompt
        assert q.enqueued == [job.id]


@pytest.mark.asyncio
async def test_run_generation_retries_then_completes(session_factory, storage):
    providers = {"mock": MockProvider(latency=0, fail_first_n=1)}
    async with session_factory() as session:
        q = FakeQueue(providers)
        job = await generation_service.create_generation_job(
            session, q, "proj-city-bou", "panel-01", provider_name="mock"
        )
    await generation_service.run_generation(session_factory, storage, providers, job.id)
    async with session_factory() as session:
        done = await session.get(generation_service.GenerationModel, job.id)
        assert done.status == "completed"
        assert done.attempt_count == 2
        assert done.image_url is not None
        assert done.latency_ms is not None


@pytest.mark.asyncio
async def test_run_generation_permanent_failure(session_factory, storage):
    providers = {"mock": MockProvider(latency=0, fail_first_n=99)}  # always 429s; retries exhaust
    async with session_factory() as session:
        q = FakeQueue(providers)
        job = await generation_service.create_generation_job(
            session, q, "proj-city-bou", "panel-21", provider_name="mock"
        )
    await generation_service.run_generation(session_factory, storage, providers, job.id)
    async with session_factory() as session:
        done = await session.get(generation_service.GenerationModel, job.id)
        assert done.status == "failed"
        assert done.error["code"] == "PROVIDER_RATE_LIMIT"
        # panel mirrors the failure
        panel = await session.get(generation_service.PanelModel, "panel-21")
        assert panel.status == "failed"


@pytest.mark.asyncio
async def test_regenerate_reuses_context(session_factory):
    providers = {"mock": MockProvider(latency=0)}
    async with session_factory() as session:
        q = FakeQueue(providers)
        original = await generation_service.create_generation_job(
            session, q, "proj-city-bou", "panel-20", provider_name="mock"
        )
        again = await generation_service.regenerate(session, q, original.id)
        assert again.prompt == original.prompt
        assert again.id != original.id
        overridden = await generation_service.regenerate(
            session, q, original.id, prompt_override="a quiet wide shot of the empty stadium after the winner"
        )
        assert overridden.prompt != original.prompt


@pytest.mark.asyncio
async def test_batch_limit_enforced(session_factory):
    providers = {"mock": MockProvider(latency=0)}
    async with session_factory() as session:
        q = FakeQueue(providers)
        with pytest.raises(ProviderError) as exc:
            await generation_service.batch_generate(
                session, q, "proj-city-bou", ["panel-01"] * 26, "mock"
            )
        assert exc.value.code == "BATCH_TOO_LARGE"


@pytest.mark.asyncio
async def test_history_filters(session_factory):
    providers = {"mock": MockProvider(latency=0)}
    async with session_factory() as session:
        q = FakeQueue(providers)
        await generation_service.create_generation_job(session, q, "proj-city-bou", "panel-01", "mock")
        queued = await generation_service.list_generations(session, status="queued")
        assert len(queued) == 1
        none = await generation_service.list_generations(session, status="completed")
        assert none == []


# ------------------------------------------------ meta ----

@pytest.mark.asyncio
async def test_health_contract():
    from httpx import ASGITransport, AsyncClient
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "service": "bryme-image-engine"}
`,
  },
]

