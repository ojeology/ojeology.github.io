/* Production backend bundle — part 1/3: root files + app core */

export interface BackendFile {
  path: string;
  language: "python" | "md" | "yml" | "docker" | "txt" | "toml";
  code: string;
}

export const CORE_FILES: BackendFile[] = [
  {
    path: "README.md",
    language: "md",
    code: `# BRYME Image Engine

A structured AI comic-generation engine. The image provider is only the
renderer — BRYME owns character consistency, visual identity, comic
sequencing, match events, dialogue, prompt composition, projects,
history, storage and regeneration.

## Quickstart

    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env
    uvicorn app.main:app --reload

or with Docker:

    docker compose up --build

Then open http://localhost:8000/api/docs

Health check:

    curl http://localhost:8000/health
    # {"status":"ok","service":"bryme-image-engine"}

## Demo flow (no paid keys required)

The engine boots with a seeded project — "Manchester City vs
Bournemouth" — and a deterministic \`mock\` provider, so the full
pipeline runs end-to-end without external credentials:

    # 1. preview the composed prompt for panel 20
    curl -X POST http://localhost:8000/api/v1/prompts/preview \\
      -H 'Content-Type: application/json' \\
      -d '{"project_id":"proj-city-bou","panel_id":"panel-20"}'

    # 2. generate the panel through the whole pipeline
    curl -X POST http://localhost:8000/api/v1/projects/proj-city-bou/panels/panel-20/generate \\
      -H 'Content-Type: application/json' \\
      -d '{"provider":"mock"}'

    # 3. poll the job
    curl http://localhost:8000/api/v1/generations/<generation_id>

Set \`DEFAULT_PROVIDER=openai\` with an \`OPENAI_API_KEY\` to render for real.

## Architecture

    app/
      main.py                 app factory, health, error normalization
      config.py               pydantic-settings, env-driven
      db.py                   async SQLAlchemy engine/session
      models.py               Project, Panel, Character, Team, Style, Generation
      schemas.py              validated request/response contracts
      api/v1/                 routers: projects, panels, prompts, generations,
                              characters, teams, styles, providers
      services/
        prompt_engine.py      structured prompt composer + negative engine
        continuity_service.py previous-panel continuity + reference images
        generation_service.py orchestration: jobs, batch, regenerate, history
      providers/              ImageProvider adapters (openai, stability, flux, mock)
      storage/                ImageStorage abstraction (local dev / object storage)
      workers/queue.py        async job queue: concurrency, retry, backoff, cancel
      seed.py                 demo match-day seed
    tests/                    pytest suite — provider APIs mocked (respx)

## Non-destructive Studio (layer 3)

Nothing is baked until export. A scene is **structured project data**,
never a pre-rendered clip:

    Scene
    ├── image_asset      (revision history + revert)
    ├── characters       (Sports Bible references)
    ├── dialogue_lines
    ├── voice_assets     (ai | upload | recording)
    ├── speech_bubbles   (geometry, skin, font, animation)
    ├── sound_effects
    ├── music
    ├── camera_animation
    ├── transitions
    └── timing           (derived from real audio durations)

Every route touches exactly one layer, and every edit writes a
**mutation ledger** row recording which layers it preserved:

    GET /api/v1/scenes/{id}/mutations
    [{"op":"bubble.update","touched":["bubbles"],
      "preserved":["image","dialogue","voice","sfx","camera",...],
      "cost":"free"}]

| edit                | image re-rendered | voice re-synthesized |
|---------------------|-------------------|----------------------|
| move/style a bubble | no                | no                   |
| camera move         | no                | no                   |
| aspect ratio        | no                | no                   |
| dialogue text       | no                | flagged stale only   |
| replace/record voice| no                | that one line        |
| replace image       | that image only   | no                   |

Replacing an image **appends** a revision — the old row is kept, so
\`POST /scenes/{id}/image/revert\` is a pointer move, not a re-download.

### Gemini

    BRYME FRONTEND → BRYME BACKEND → GeminiProvider → Google

\`GEMINI_API_KEY\` lives in the server environment. The browser posts to
\`/api/v1/images/edit\`; the key is never serialised into a response, and
the Gemini site is never iframed or embedded.

### Sports Bible

\`GET /api/v1/sports-bible?team_id=city\` — full squads, managers,
referees and officials. **Never capped at eleven.** Stable IDs mean the
same player keeps the same face across all 26 panels.

### Export is an output

    PROJECT DATA → TIMELINE → RENDER → MP4

Never the reverse. After an export the document is untouched and fully
editable; \`tests/test_editor.py\` asserts exactly that.

## Motion Comic Editor (layer 2)

Static panels become an animated motion comic. **No audio upload is
ever required** — voices are synthesized from the dialogue you already
wrote, and the timeline is built from the *measured* length of that
audio.

    panels -> dialogue -> TTS -> exact durations -> timeline
      -> speech bubbles -> camera moves -> transitions -> SFX -> MP4

One call does the whole thing:

    # 5-panel acceptance test, zero paid keys
    curl -X POST http://localhost:8000/api/v1/motion-comics/mc_citybou_01/auto-build \\
      -H 'Content-Type: application/json' -d '{"tts_provider":"mock"}'
    # {"status":"ready","total_panels":5,"total_duration":31.4,...}

    curl -X POST http://localhost:8000/api/v1/motion-comics/mc_citybou_01/render \\
      -H 'Content-Type: application/json' -d '{"format":"mp4"}'

    curl http://localhost:8000/api/v1/motion-comics/mc_citybou_01/render-status
    # {"status":"rendering","progress":67,"current_panel":18,"total_panels":26}

Rendering is async — the request never waits on FFmpeg.

### Voice matrix

| provider   | voices                              | exact duration | emotion | SSML | Nigerian English | native Pidgin |
|------------|-------------------------------------|----------------|---------|------|------------------|---------------|
| mock       | synthetic WAV                       | yes            | n/a     | no   | no               | **no**        |
| azure      | en-NG-AbeoNeural, en-NG-EzinneNeural| yes            | yes     | yes  | **yes**          | **no**        |
| elevenlabs | library / cloned                    | yes            | yes     | no   | yes (community)  | **no**        |

**On Nigerian Pidgin:** no mainstream TTS API exposes a Pidgin locale,
and the engine never pretends otherwise. Pidgin dialogue is stored and
sent **verbatim** — never translated, never "corrected" — and voiced by
the closest Nigerian English voice. \`native_pidgin_locale\` is \`False\`
on every adapter.

### Cost control

Audio is cached on \`sha256(text + voice + emotion + speed + pitch)\`.

| you change        | image re-rendered | voice re-synthesized |
|-------------------|-------------------|----------------------|
| bubble style/pos  | no                | no                   |
| camera move       | no                | no                   |
| aspect ratio      | no                | no                   |
| dialogue text     | no                | flagged stale, on request |
| voice / emotion   | no                | yes (that line only) |
| full scene regen  | yes               | yes                  |

### Aspect ratios & safe zones

16:9 (1920×1080), 9:16 (1080×1920) and 1:1 (1080×1080). Artwork is
**cropped and panned, never stretched**. In 9:16 the bottom 22% and
right 16% are reserved for platform UI and captions, so dialogue is
never placed under the TikTok/Shorts action rail.

### Sound

All effects resolve to bundled CC0/original assets in \`assets/sfx\` and
are mixed **beneath** the voice bed. No broadcast audio, no commentary
rips, no copyrighted music. Background music is optional and
user-supplied.

Rendering requires \`ffmpeg\` and \`ffprobe\` on PATH (both are in the
Docker image).

## Provider matrix

| provider  | model           | negative prompt | reference images | seed |
|-----------|-----------------|-----------------|------------------|------|
| mock      | bryme/mock-1    | yes             | yes              | yes  |
| openai    | gpt-image-1     | no (rewritten)  | yes (edits)      | no   |
| stability | sd3.5-large     | yes             | no               | yes  |
| flux      | flux-pro-1.1    | no              | no               | yes  |

Capabilities are declared per adapter. If a request needs something the
selected provider cannot do, the engine returns a capability warning —
it never silently drops it.

## Errors

Every failure is normalized:

    {"error":{"code":"PROVIDER_RATE_LIMIT","message":"...","retryable":true}}

## Tests

    pytest -q

No real paid API calls are ever made during tests.
`,
  },
  {
    path: ".env.example",
    language: "txt",
    code: `# ---- service ----
APP_NAME=bryme-image-engine
API_PREFIX=/api/v1
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# ---- database (sqlite for dev, postgres for prod) ----
DATABASE_URL=sqlite+aiosqlite:///./bryme.db
# DATABASE_URL=postgresql+asyncpg://bryme:bryme@db:5432/bryme

# ---- storage ----
STORAGE_BACKEND=local
STORAGE_DIR=./data/images
PUBLIC_BASE_URL=http://localhost:8000/static

# ---- image providers ----
# Keys are server-side ONLY. Nothing here is ever serialised to the browser.
DEFAULT_PROVIDER=mock
GEMINI_API_KEY=
OPENAI_API_KEY=
STABILITY_API_KEY=
BFL_API_KEY=
PROVIDER_TIMEOUT_SECONDS=120

# ---- voice (TTS) providers ----
# mock renders real silent WAVs of exact length: full pipeline, zero spend.
DEFAULT_TTS_PROVIDER=mock
# azure ships genuine en-NG Nigerian English neural voices (Abeo / Ezinne)
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=westeurope
ELEVENLABS_API_KEY=

# ---- video rendering (requires ffmpeg + ffprobe on PATH) ----
RENDER_WORK_DIR=./data/render_work
RENDER_OUTPUT_DIR=./data/renders
RENDER_CONCURRENCY=1
SFX_DIR=./assets/sfx

# ---- job queue ----
QUEUE_CONCURRENCY=2
MAX_RETRIES=3
RETRY_BACKOFF_SECONDS=0.8
BATCH_MAX=25

# ---- demo seed ----
SEED_DEMO=true
`,
  },
  {
    path: "requirements.txt",
    language: "txt",
    code: `fastapi==0.115.6
uvicorn[standard]==0.34.0
sqlalchemy[asyncio]==2.0.36
pydantic==2.10.4
pydantic-settings==2.7.0
httpx==0.28.1
aiosqlite==0.20.0
asyncpg==0.30.0
alembic==1.14.0
python-dotenv==1.0.1
pydantic-extra-types==2.10.1
pillow==11.1.0
pytest==8.3.4
pytest-asyncio==0.25.0
respx==0.22.0
`,
  },
  {
    path: "Dockerfile",
    language: "docker",
    code: `FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1

WORKDIR /srv/bryme

# ffmpeg + ffprobe power the motion-comic renderer and audio probing;
# the font package is what Pillow uses to letter speech bubbles.
RUN apt-get update && apt-get install -y --no-install-recommends \\
        ffmpeg fonts-dejavu-core \\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY assets ./assets

RUN useradd --create-home bryme \\
    && mkdir -p /srv/bryme/data/images /srv/bryme/data/renders /srv/bryme/data/render_work \\
    && chown -R bryme:bryme /srv/bryme
USER bryme

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
  },
  {
    path: "docker-compose.yml",
    language: "yml",
    code: `services:
  api:
    build: .
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://bryme:bryme@db:5432/bryme
    volumes:
      - bryme-images:/srv/bryme/data/images
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bryme
      POSTGRES_PASSWORD: bryme
      POSTGRES_DB: bryme
    volumes:
      - bryme-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bryme"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  bryme-db:
  bryme-images:
`,
  },
  {
    path: "app/__init__.py",
    language: "python",
    code: `__version__ = "1.0.0"
`,
  },
  {
    path: "app/config.py",
    language: "python",
    code: `"""Environment-driven configuration. Secrets come from env vars only."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "bryme-image-engine"
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:5173"

    database_url: str = "sqlite+aiosqlite:///./bryme.db"

    storage_backend: str = "local"
    storage_dir: str = "./data/images"
    public_base_url: str = "http://localhost:8000/static"

    default_provider: str = "mock"
    gemini_api_key: str = ""          # server-side only — never returned by any route
    openai_api_key: str = ""
    stability_api_key: str = ""
    bfl_api_key: str = ""
    provider_timeout_seconds: float = 120.0

    # ---- motion / voice layer ----
    default_tts_provider: str = "mock"
    elevenlabs_api_key: str = ""
    azure_speech_key: str = ""
    azure_speech_region: str = "westeurope"
    render_work_dir: str = "./data/render_work"
    render_output_dir: str = "./data/renders"
    render_concurrency: int = 1          # ffmpeg is CPU-hungry; keep it serial
    sfx_dir: str = "./assets/sfx"

    queue_concurrency: int = 2
    max_retries: int = 3
    retry_backoff_seconds: float = 0.8
    batch_max: int = 25

    seed_demo: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
`,
  },
  {
    path: "app/db.py",
    language: "python",
    code: `"""Async SQLAlchemy wiring. SQLite in dev, PostgreSQL in prod — swap the URL."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session():
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # Alembic migrations/ manages schema evolution; create_all keeps
    # first-boot and tests zero-friction.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
`,
  },
  {
    path: "app/models.py",
    language: "python",
    code: `"""Database models. JSON columns keep the engine portable across
sqlite (dev/tests) and postgres (prod). IDs are prefixed, sortable-free
random hex — generation_8f72... style."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CharacterModel(Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("char"))
    name: Mapped[str] = mapped_column(String(120))
    team_id: Mapped[str] = mapped_column(String(32), index=True)
    role: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    hair: Mapped[str] = mapped_column(String(240), default="")
    face: Mapped[str] = mapped_column(String(240), default="")
    body: Mapped[str] = mapped_column(String(240), default="")
    age_appearance: Mapped[str] = mapped_column(String(60), default="")
    expression: Mapped[str] = mapped_column(String(240), default="")
    kit: Mapped[str] = mapped_column(Text, default="")
    personality: Mapped[str] = mapped_column(String(240), default="")
    visual_style: Mapped[str] = mapped_column(String(64), default="")
    reference_images: Mapped[list] = mapped_column(JSON, default=list)
    negative: Mapped[list] = mapped_column(JSON, default=list)
    fictional: Mapped[bool] = mapped_column(default=True)  # engine stores originals only
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class TeamModel(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("team"))
    name: Mapped[str] = mapped_column(String(120))
    colors: Mapped[list] = mapped_column(JSON, default=list)
    secondary_colors: Mapped[list] = mapped_column(JSON, default=list)
    kit: Mapped[str] = mapped_column(Text, default="")  # original design, no badges
    manager_character: Mapped[str] = mapped_column(String(120), default="")
    stadium: Mapped[str] = mapped_column(Text, default="")
    supporter_style: Mapped[str] = mapped_column(Text, default="")
    identity_notes: Mapped[str] = mapped_column(Text, default="")
    reference_images: Mapped[list] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class StyleModel(Base):
    __tablename__ = "styles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    characteristics: Mapped[list] = mapped_column(JSON, default=list)
    prompt_fragment: Mapped[str] = mapped_column(Text, default="")
    negative_prompt: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class ProjectModel(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("proj"))
    name: Mapped[str] = mapped_column(String(200))
    match: Mapped[str] = mapped_column(String(200), default="")
    style_id: Mapped[str] = mapped_column(String(64), index=True)
    team_ids: Mapped[list] = mapped_column(JSON, default=list)
    character_ids: Mapped[list] = mapped_column(JSON, default=list)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class PanelModel(Base):
    __tablename__ = "panels"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("panel"))
    project_id: Mapped[str] = mapped_column(String(32), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200), default="")
    scene: Mapped[str] = mapped_column(Text, default="")
    event: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dialogue: Mapped[list] = mapped_column(JSON, default=list)
    character_ids: Mapped[list] = mapped_column(JSON, default=list)
    camera: Mapped[str | None] = mapped_column(Text, nullable=True)
    environment: Mapped[str | None] = mapped_column(Text, nullable=True)
    aspect_ratio: Mapped[str] = mapped_column(String(8), default="16:9")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_generation_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class GenerationModel(Base):
    __tablename__ = "generations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: _id("gen"))
    project_id: Mapped[str] = mapped_column(String(32), index=True)
    panel_id: Mapped[str] = mapped_column(String(32), index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str] = mapped_column(Text, default="")
    request: Mapped[dict] = mapped_column(JSON, default=dict)   # full context snapshot
    reference_images: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
`,
  },
  {
    path: "app/schemas.py",
    language: "python",
    code: `"""API contracts. Every field validated; dialogue preserved verbatim."""
from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ASPECT_RATIOS = {"1:1", "16:9", "9:16", "4:3", "3:4"}
MINUTE_RE = re.compile(r"^\\d{1,3}(\\+\\d{1,2})?'?$")


class EventType(str, Enum):
    goal = "goal"
    assist = "assist"
    yellow_card = "yellow_card"
    red_card = "red_card"
    substitution = "substitution"
    penalty = "penalty"
    miss = "miss"
    save = "save"
    var = "var"
    injury = "injury"
    kickoff = "kickoff"
    half_time = "half_time"
    full_time = "full_time"
    celebration = "celebration"
    argument = "argument"
    crowd_reaction = "crowd_reaction"


class DialogueKind(str, Enum):
    speech = "speech"
    narration = "narration"
    caption = "caption"
    commentary = "commentary"
    crowd = "crowd"


class MatchEvent(BaseModel):
    minute: str
    type: EventType
    team: str = Field(min_length=1, max_length=120)
    player: Optional[str] = Field(default=None, max_length=120)
    assist: Optional[str] = Field(default=None, max_length=120)
    detail: Optional[str] = Field(default=None, max_length=240)

    @field_validator("minute")
    @classmethod
    def _minute(cls, v: str) -> str:
        v = v.strip()
        if not MINUTE_RE.match(v):
            raise ValueError("minute must look like 34, 90+1 or 45+2'")
        return v


class DialogueEntry(BaseModel):
    speaker: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=600)   # preserved exactly — never rewritten
    kind: DialogueKind = DialogueKind.speech
    language: Optional[str] = Field(default=None, max_length=60)


# ---------- bibles ----------

class CharacterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    team_id: str
    role: str = ""
    description: str = ""
    hair: str = ""
    face: str = ""
    body: str = ""
    age_appearance: str = ""
    expression: str = ""
    kit: str = ""
    personality: str = ""
    visual_style: str = ""
    reference_images: list[str] = []
    negative: list[str] = []
    version: int = 1


class CharacterOut(CharacterIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    fictional: bool
    created_at: datetime


class TeamIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    colors: list[str] = []
    secondary_colors: list[str] = []
    kit: str = ""
    manager_character: str = ""
    stadium: str = ""
    supporter_style: str = ""
    identity_notes: str = ""
    reference_images: list[str] = []


class TeamOut(TeamIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version: int


class StyleIn(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    characteristics: list[str] = []
    prompt_fragment: str = ""
    negative_prompt: str = ""


class StyleOut(StyleIn):
    model_config = ConfigDict(from_attributes=True)
    version: int


# ---------- projects & panels ----------

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    match: str = ""
    style_id: str
    team_ids: list[str] = []
    character_ids: list[str] = []
    meta: dict = {}


class ProjectOut(ProjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class PanelIn(BaseModel):
    number: int = Field(ge=1, le=500)
    title: str = ""
    scene: str = Field(default="", max_length=2000)
    event: Optional[MatchEvent] = None
    dialogue: list[DialogueEntry] = []
    character_ids: list[str] = []
    camera: Optional[str] = None
    environment: Optional[str] = None
    aspect_ratio: str = "16:9"

    @field_validator("aspect_ratio")
    @classmethod
    def _ar(cls, v: str) -> str:
        if v not in ASPECT_RATIOS:
            raise ValueError(f"aspect_ratio must be one of {sorted(ASPECT_RATIOS)}")
        return v


class PanelOut(PanelIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    status: str
    image_url: Optional[str]
    last_generation_id: Optional[str]


# ---------- generation ----------

class GenerateRequest(BaseModel):
    provider: Optional[str] = None      # falls back to configured default
    seed: Optional[int] = None          # rejected for seed-incapable providers
    extra_negative: list[str] = []      # per-project negative extensions


class BatchGenerateRequest(BaseModel):
    project_id: str
    panel_ids: list[str] = Field(min_length=1, max_length=25)
    provider: Optional[str] = None


class RegenerateRequest(BaseModel):
    prompt_override: Optional[str] = Field(default=None, max_length=4000)
    style_override: Optional[str] = None
    seed: Optional[int] = None


class PreviewRequest(BaseModel):
    project_id: str
    panel_id: str
    prompt_override: Optional[str] = None
    style_override: Optional[str] = None


class PreviewResponse(BaseModel):
    prompt: str
    negative_prompt: str
    characters: list[str]
    style: str
    continuity: list[str]
    warnings: list[str]


class GenerationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    panel_id: str
    provider: str
    status: str
    attempt_count: int
    prompt: str
    negative_prompt: str
    reference_images: list[str]
    warnings: list[str]
    seed: Optional[int]
    image_url: Optional[str]
    error: Optional[dict]
    latency_ms: Optional[int]
    created_at: datetime
    completed_at: Optional[datetime]


class ProviderInfo(BaseModel):
    id: str
    label: str
    model: str
    configured: bool
    capabilities: dict
    notes: str = ""


class NormalizedErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: NormalizedErrorBody
`,
  },
]

