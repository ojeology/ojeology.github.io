import type { BackendFile } from "./catalog_core";

export const SERVICE_FILES: BackendFile[] = [
  {
    path: "app/services/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/services/prompt_engine.py",
    language: "python",
    code: `"""Structured prompt composition.

Pipeline: GLOBAL STYLE + CHARACTER BIBLE + TEAM BIBLE + SCENE
+ MATCH EVENT + CAMERA + ENVIRONMENT + DIALOGUE + CONTINUITY
+ ORIGINALITY RULES -> final prompt.

Not string concatenation: a PromptContext is assembled, each layer
rendered deliberately, then joined deterministically.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas import DialogueEntry, EventType, MatchEvent

BASE_NEGATIVE = [
    "photograph", "broadcast screenshot", "official club badge", "sponsor logo",
    "copyrighted artwork", "copied illustration", "watermark", "distorted anatomy",
    "duplicate player", "extra limbs", "malformed hands", "unreadable text",
    "inconsistent uniform", "random character change",
]

ORIGINALITY_RULES = [
    "all characters are original fictional athletes, not depictions of real people",
    "no official club crests, sponsor marks or league branding anywhere in frame",
    "kits are original designs using team colours only",
    "likeness is driven exclusively by the character bible, never by reference photos of real athletes",
]


def camera_for(event_type: EventType | None) -> str:
    table = {
        EventType.goal: "low cinematic angle behind the strike, net bulging toward camera",
        EventType.save: "side-on low angle at pitch level, frozen high-speed moment",
        EventType.penalty: "side-on low angle at pitch level, frozen high-speed moment",
        EventType.var: "slightly tilted tension angle at chest height",
        EventType.argument: "slightly tilted tension angle at chest height",
        EventType.kickoff: "wide establishing shot from high in the stands",
        EventType.crowd_reaction: "70mm close-up across the faces of the crowd",
    }
    if event_type in table:
        return table[event_type]
    return "cinematic medium-wide angle at pitch level"


def event_scene(e: MatchEvent) -> str:
    """Convert a structured football event into visual language."""
    p = e.player or "the player"
    m = e.minute
    scenes = {
        EventType.goal: (
            f"{p} wheels away after burying the ball in the {e.detail or 'top corner'} "
            f"in the {m} minute"
            + (f", {e.assist} sprinting behind him after threading the assist" if e.assist else "")
            + ", net still rippling, crowd erupting in a wall of sound"
        ),
        EventType.assist: f"{p} threads a defence-splitting pass in the {m} minute",
        EventType.yellow_card: f"the referee holds a yellow card high toward {p} in the {m} minute, players protesting around him",
        EventType.red_card: f"the referee brandishes a straight red card at {p} in the {m} minute, disbelief on every face",
        EventType.substitution: f"the fourth official raises the board in the {m} minute, {p} stripping off on the touchline",
        EventType.penalty: f"penalty kick in the {m} minute — {p} strides up to the spot, the whole stadium holding its breath",
        EventType.miss: f"{p} holds his head in both hands after a glaring miss in the {m} minute",
        EventType.save: f"full-stretch save in the {m} minute — {p} horizontal, palming the ball off the line as turf flies",
        EventType.var: f"VAR chaos in the {m} minute — players mobbing the referee, one finger pressed to his earpiece",
        EventType.injury: f"{p} down on the turf in the {m} minute, physios sprinting on",
        EventType.kickoff: "pre-match theatre — captains at the coin toss under a wall of floodlights",
        EventType.half_time: "half-time — players trudging down the tunnel, breath steaming in the night air",
        EventType.full_time: "full-time whistle — exhausted players collapsing and embracing, the scoreline glowing behind them",
        EventType.celebration: f"{p} knee-sliding toward the corner flag in the {m} minute, arms spread, teammates pile in behind",
        EventType.argument: f"{p} nose-to-nose with the opposition in the {m} minute, teammates pulling them apart",
        EventType.crowd_reaction: f"the away end in the {m} minute — scarves aloft, mouths in perfect O's",
    }
    return scenes[e.type]


def dialogue_scene(entries: list[DialogueEntry]) -> str | None:
    if not entries:
        return None
    parts = []
    for d in entries:
        tags = {
            "speech": f"speech bubble from {d.speaker} reading exactly",
            "narration": "narration caption reading exactly",
            "caption": "caption box reading exactly",
            "commentary": "commentary box reading exactly",
            "crowd": "crowd chant bubble reading exactly",
        }
        lang = f" ({d.language}, preserved verbatim)" if d.language else ""
        parts.append(f'{tags[d.kind.value]} "{d.text}"{lang}')
    return "; ".join(parts) + ", bold clean hand-lettered comic typography"


@dataclass
class PromptContext:
    style_fragment: str
    character_block: str | None
    team_block: str | None
    scene: str
    event_text: str | None
    camera: str
    environment: str
    dialogue_block: str | None
    continuity_block: str | None
    restrictions: list[str] = field(default_factory=lambda: ORIGINALITY_RULES)
    characters: list[str] = field(default_factory=list)
    continuity: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ComposedPrompt:
    prompt: str
    negative_prompt: str
    context: PromptContext


class PromptComposer:
    """Owns the composition. Provider adapters never see this logic."""

    def compose(
        self,
        *,
        style,
        characters: list,
        teams: list,
        scene: str,
        event: MatchEvent | None = None,
        dialogue: list[DialogueEntry] | None = None,
        camera: str | None = None,
        environment: str | None = None,
        continuity: list[str] | None = None,
        extra_negative: list[str] | None = None,
    ) -> ComposedPrompt:
        warnings: list[str] = []

        character_block = None
        if characters:
            character_block = ". ".join(
                f"{c.name} ({c.role}): {c.description}; {c.hair}; {c.face}; {c.body}; "
                f"appears {c.age_appearance}; wearing {c.kit}"
                for c in characters
            )
        else:
            warnings.append("No character bibles attached — identity consistency is not anchored.")

        uniq_teams = list({t.id: t for t in teams}.values())
        team_block = "; ".join(f"{t.name} in {t.kit}" for t in uniq_teams) or None

        event_text = event_scene(event) if event else None
        dlg_block = dialogue_scene(dialogue or [])
        continuity = continuity or []
        continuity_block = (
            "continuity with previous panels: "
            + "; ".join(continuity)
            + " — same faces, same hair, same kits, same proportions as established"
            if continuity
            else None
        )

        ctx = PromptContext(
            style_fragment=style.prompt_fragment,
            character_block=character_block,
            team_block=team_block,
            scene=scene,
            event_text=event_text,
            camera=camera or camera_for(event.type if event else None),
            environment=environment or (uniq_teams[0].stadium + ", electric atmosphere" if uniq_teams else "floodlit night stadium, electric atmosphere"),
            dialogue_block=dlg_block,
            continuity_block=continuity_block,
            characters=[c.id for c in characters],
            continuity=continuity,
            warnings=warnings,
        )

        prompt = ". ".join(
            part
            for part in [
                ctx.style_fragment,
                character_block,
                team_block,
                f"Scene: {scene}",
                f"Moment: {event_text}" if event_text else None,
                f"Camera: {ctx.camera}",
                f"Setting: {ctx.environment}",
                dlg_block,
                continuity_block,
                "Rules: " + "; ".join(ctx.restrictions),
            ]
            if part
        )

        negatives = list(BASE_NEGATIVE)
        if style.negative_prompt:
            negatives.extend(n.strip() for n in style.negative_prompt.split(",") if n.strip())
        for c in characters:
            negatives.extend(c.negative)
        negatives.extend(extra_negative or [])

        return ComposedPrompt(
            prompt=prompt,
            negative_prompt=", ".join(dict.fromkeys(negatives)),
            context=ctx,
        )


composer = PromptComposer()
`,
  },
  {
    path: "app/services/continuity_service.py",
    language: "python",
    code: `"""Panel-over-panel continuity.

Panel 15's Character A must equal panel 14's Character A. We anchor this
two ways: a textual continuity block built from previous panels, and
reference images (previous panel output + character reference sheets)
for providers that support image conditioning.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CharacterModel, PanelModel


async def previous_panel_summaries(
    session: AsyncSession, project_id: str, number: int, limit: int = 2
) -> list[str]:
    result = await session.execute(
        select(PanelModel)
        .where(PanelModel.project_id == project_id, PanelModel.number < number)
        .order_by(PanelModel.number.desc())
        .limit(limit)
    )
    previous = list(reversed(result.scalars().all()))
    return [f"panel {p.number}: {p.scene}" for p in previous if p.scene]


async def reference_images(
    session: AsyncSession, project_id: str, number: int, character_ids: list[str]
) -> list[str]:
    """Priority: last completed panel image, then character reference sheets."""
    refs: list[str] = []

    result = await session.execute(
        select(PanelModel)
        .where(
            PanelModel.project_id == project_id,
            PanelModel.number < number,
            PanelModel.image_url.isnot(None),
        )
        .order_by(PanelModel.number.desc())
        .limit(1)
    )
    last_rendered = result.scalar_one_or_none()
    if last_rendered and last_rendered.image_url:
        refs.append(last_rendered.image_url)

    if character_ids:
        result = await session.execute(
            select(CharacterModel).where(CharacterModel.id.in_(character_ids))
        )
        for ch in result.scalars().all():
            refs.extend(ch.reference_images[:1])

    deduped = list(dict.fromkeys(refs))
    return deduped[:3]
`,
  },
  {
    path: "app/services/generation_service.py",
    language: "python",
    code: `"""Generation orchestration — the heart of the engine.

Owns: context loading, prompt composition, provider selection,
capability checks, job creation, retries, batch, regeneration and
history. Provider adapters only ever receive a finished prompt.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import CharacterModel, GenerationModel, PanelModel, ProjectModel, StyleModel, TeamModel
from app.providers.base import ImageProvider, ProviderError
from app.schemas import DialogueEntry, MatchEvent
from app.services import continuity_service
from app.services.prompt_engine import composer
from app.storage.base import ImageStorage
from app.workers.queue import GenerationQueue

settings = get_settings()

STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_RETRYING = "retrying"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"


class NotFound(ProviderError):
    def __init__(self, what: str):
        super().__init__("NOT_FOUND", f"{what} not found.", retryable=False, http_status=404)


async def _load(session: AsyncSession, model, ident: str, what: str):
    obj = await session.get(model, ident)
    if obj is None:
        raise NotFound(what)
    return obj


# ------------------------------------------------------------------
# prompt preview — POST /api/v1/prompts/preview
# ------------------------------------------------------------------

async def compose_panel_prompt(
    session: AsyncSession,
    project_id: str,
    panel_id: str,
    prompt_override: str | None = None,
    style_override: str | None = None,
    extra_negative: list[str] | None = None,
):
    project = await _load(session, ProjectModel, project_id, "Project")
    panel = await _load(session, PanelModel, panel_id, "Panel")
    style = await _load(session, StyleModel, style_override or project.style_id, "Style")

    characters = []
    if panel.character_ids:
        result = await session.execute(
            select(CharacterModel).where(CharacterModel.id.in_(panel.character_ids))
        )
        characters = result.scalars().all()
        teams = []
        if characters:
            result = await session.execute(
                select(TeamModel).where(TeamModel.id.in_([c.team_id for c in characters]))
            )
            teams = result.scalars().all()
    else:
        characters = []
        result = await session.execute(select(TeamModel).where(TeamModel.id.in_(project.team_ids)))
        teams = result.scalars().all()

    continuity = await continuity_service.previous_panel_summaries(session, project_id, panel.number)
    event = MatchEvent(**panel.event) if panel.event else None
    dialogue = [DialogueEntry(**d) for d in panel.dialogue]

    composed = composer.compose(
        style=style,
        characters=list(characters),
        teams=list(teams),
        scene=panel.scene,
        event=event,
        dialogue=dialogue,
        camera=panel.camera,
        environment=panel.environment,
        continuity=continuity,
        extra_negative=extra_negative,
    )
    if prompt_override:
        composed.prompt = prompt_override
    return project, panel, composed


async def preview_prompt(session, project_id, panel_id, prompt_override=None, style_override=None):
    _, _, composed = await compose_panel_prompt(
        session, project_id, panel_id, prompt_override, style_override
    )
    return {
        "prompt": composed.prompt,
        "negative_prompt": composed.negative_prompt,
        "characters": composed.context.characters,
        "style": style_override or "project-default",
        "continuity": composed.context.continuity,
        "warnings": composed.context.warnings,
    }


# ------------------------------------------------------------------
# job creation + enqueue
# ------------------------------------------------------------------

def _resolve_provider(providers: dict[str, ImageProvider], name: str | None) -> tuple[str, ImageProvider]:
    chosen = name or settings.default_provider
    provider = providers.get(chosen)
    if provider is None:
        raise ProviderError(
            "PROVIDER_NOT_CONFIGURED",
            f"No adapter registered for provider '{chosen}'. Registered: {', '.join(sorted(providers))}.",
            retryable=False,
            http_status=400,
        )
    if not provider.available:
        raise ProviderError(
            "PROVIDER_NOT_CONFIGURED",
            f"Provider '{chosen}' has no API key configured. Set its credential env var or choose another provider.",
            retryable=False,
            http_status=400,
        )
    return chosen, provider


def _capability_warnings(provider: ImageProvider, reference_images: list[str], seed: int | None) -> list[str]:
    w: list[str] = []
    if reference_images and not provider.capabilities.reference_images:
        w.append(
            f"CAPABILITY_WARNING: {provider.name} does not accept reference images — "
            "continuity will rely on the character-bible text block only."
        )
    if seed is not None and not provider.capabilities.seed:
        w.append(f"CAPABILITY_WARNING: {provider.name} does not expose a seed parameter — seed dropped.")
    return w


def size_for_ratio(aspect_ratio: str) -> tuple[int, int]:
    return {
        "1:1": (1024, 1024),
        "16:9": (1536, 1024),
        "9:16": (1024, 1536),
        "4:3": (1280, 960),
        "3:4": (960, 1280),
    }[aspect_ratio]


async def create_generation_job(
    session: AsyncSession,
    queue: GenerationQueue,
    project_id: str,
    panel_id: str,
    provider_name: str | None = None,
    prompt_override: str | None = None,
    style_override: str | None = None,
    seed: int | None = None,
    extra_negative: list[str] | None = None,
) -> GenerationModel:
    chosen, provider = _resolve_provider(queue.providers, provider_name)
    project, panel, composed = await compose_panel_prompt(
        session, project_id, panel_id, prompt_override, style_override, extra_negative
    )
    if seed is not None and not provider.capabilities.seed:
        raise ProviderError(
            "CAPABILITY_UNSUPPORTED",
            f"Provider '{chosen}' does not expose a seed parameter. Supply null or pick a seed-capable provider.",
            retryable=False,
            http_status=400,
        )

    refs = await continuity_service.reference_images(session, project_id, panel.number, panel.character_ids)
    warnings = composed.context.warnings + _capability_warnings(provider, refs, seed)

    job = GenerationModel(
        project_id=project.id,
        panel_id=panel.id,
        provider=chosen,
        status=STATUS_QUEUED,
        prompt=composed.prompt,
        negative_prompt=composed.negative_prompt,
        request={
            "scene": panel.scene,
            "event": panel.event,
            "dialogue": panel.dialogue,
            "camera": panel.camera,
            "environment": panel.environment,
            "aspect_ratio": panel.aspect_ratio,
            "prompt_override": prompt_override,
            "style_override": style_override,
        },
        reference_images=refs,
        warnings=warnings,
        seed=seed,
    )
    session.add(job)
    panel.status = STATUS_QUEUED
    panel.last_generation_id = job.id
    await session.commit()
    await session.refresh(job)

    await queue.enqueue(job.id)
    return job


async def batch_generate(
    session: AsyncSession,
    queue: GenerationQueue,
    project_id: str,
    panel_ids: list[str],
    provider_name: str | None,
) -> list[GenerationModel]:
    if len(panel_ids) > settings.batch_max:
        raise ProviderError(
            "BATCH_TOO_LARGE",
            f"Batch limited to {settings.batch_max} panels per request.",
            retryable=False,
            http_status=400,
        )
    jobs = []
    for pid in panel_ids:
        jobs.append(await create_generation_job(session, queue, project_id, pid, provider_name))
    return jobs


async def regenerate(
    session: AsyncSession,
    queue: GenerationQueue,
    generation_id: str,
    prompt_override: str | None = None,
    style_override: str | None = None,
    seed: int | None = None,
) -> GenerationModel:
    original = await _load(session, GenerationModel, generation_id, "Generation")
    return await create_generation_job(
        session,
        queue,
        original.project_id,
        original.panel_id,
        original.provider,
        prompt_override or original.request.get("prompt_override"),
        style_override or original.request.get("style_override"),
        seed,
    )


async def list_generations(
    session: AsyncSession,
    project_id: str | None = None,
    panel_id: str | None = None,
    status: str | None = None,
    provider: str | None = None,
    created_after: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
):
    stmt = select(GenerationModel).order_by(GenerationModel.created_at.desc())
    if project_id:
        stmt = stmt.where(GenerationModel.project_id == project_id)
    if panel_id:
        stmt = stmt.where(GenerationModel.panel_id == panel_id)
    if status:
        stmt = stmt.where(GenerationModel.status == status)
    if provider:
        stmt = stmt.where(GenerationModel.provider == provider)
    if created_after:
        stmt = stmt.where(GenerationModel.created_at >= created_after)
    stmt = stmt.limit(min(limit, 200)).offset(offset)
    result = await session.execute(stmt)
    return result.scalars().all()


# ------------------------------------------------------------------
# worker callback — run one job end-to-end with retries
# ------------------------------------------------------------------

async def run_generation(
    session_factory: async_sessionmaker,
    storage: ImageStorage,
    providers: dict[str, ImageProvider],
    job_id: str,
) -> None:
    async with session_factory() as session:
        job = await session.get(GenerationModel, job_id)
        if job is None or job.status == STATUS_CANCELLED:
            return
        provider = providers[job.provider]
        panel = await session.get(PanelModel, job.panel_id)

        job.status = STATUS_PROCESSING
        if panel:
            panel.status = STATUS_PROCESSING
        await session.commit()

        width, height = size_for_ratio(job.request.get("aspect_ratio", "16:9"))
        attempt = 0
        while True:
            attempt += 1
            job.attempt_count = attempt
            job.status = STATUS_PROCESSING
            await session.commit()
            try:
                t0 = time.monotonic()
                result = await provider.generate(
                    prompt=job.prompt,
                    negative_prompt=job.negative_prompt,
                    width=width,
                    height=height,
                    image_count=1,
                    reference_images=job.reference_images if provider.capabilities.reference_images else None,
                    seed=job.seed,
                )
                ext = "png"
                stored = await storage.save(result.image_bytes[0], ext)
                job.status = STATUS_COMPLETED
                job.image_url = stored.url
                job.latency_ms = int((time.monotonic() - t0) * 1000)
                job.seed = result.seed if result.seed is not None else job.seed
                job.completed_at = datetime.now(timezone.utc)
                job.error = None
                if panel:
                    panel.status = STATUS_COMPLETED
                    panel.image_url = stored.url
                await session.commit()
                return
            except ProviderError as exc:
                if exc.retryable and attempt < settings.max_retries:
                    job.status = STATUS_RETRYING
                    job.error = {"code": exc.code, "message": exc.message, "retryable": True}
                    await session.commit()
                    await asyncio.sleep(settings.retry_backoff_seconds * (2 ** (attempt - 1)))
                    continue
                job.status = STATUS_FAILED
                job.error = {"code": exc.code, "message": exc.message, "retryable": exc.retryable}
                job.completed_at = datetime.now(timezone.utc)
                if panel:
                    panel.status = STATUS_FAILED
                await session.commit()
                return
            except Exception as exc:  # never propagate raw provider internals
                job.status = STATUS_FAILED
                job.error = {"code": "GENERATION_FAILED", "message": str(exc)[:400], "retryable": False}
                job.completed_at = datetime.now(timezone.utc)
                if panel:
                    panel.status = STATUS_FAILED
                await session.commit()
                return
`,
  },
  {
    path: "app/providers/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/providers/base.py",
    language: "python",
    code: `"""Provider-agnostic image generation.

The engine never calls a vendor API directly. Adapters implement
ImageProvider.generate and declare their capabilities honestly.
Every failure is normalized into ProviderError — no vendor-specific
exceptions ever leak into services or routes.
"""
from __future__ import annotations

import base64
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, http_status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.http_status = http_status

    # ---- factories keep the vocabulary consistent ----
    @classmethod
    def auth(cls, provider: str) -> "ProviderError":
        return cls("PROVIDER_AUTH", f"{provider}: API key missing or rejected.", False, 502)

    @classmethod
    def rate_limit(cls, provider: str, retry_after: str | None = None) -> "ProviderError":
        hint = f" Retry after {retry_after}s." if retry_after else ""
        return cls("PROVIDER_RATE_LIMIT", f"{provider}: rate limit reached.{hint}", True, 429)

    @classmethod
    def timeout(cls, provider: str) -> "ProviderError":
        return cls("PROVIDER_TIMEOUT", f"{provider}: request timed out.", True, 504)

    @classmethod
    def unavailable(cls, provider: str) -> "ProviderError":
        return cls("PROVIDER_UNAVAILABLE", f"{provider}: service unavailable.", True, 503)

    @classmethod
    def invalid_prompt(cls, provider: str, detail: str) -> "ProviderError":
        return cls("PROVIDER_INVALID_PROMPT", f"{provider}: prompt rejected — {detail}", False, 422)

    @classmethod
    def storage(cls, detail: str) -> "ProviderError":
        return cls("STORAGE_FAILURE", f"storage: {detail}", True, 500)

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable}}


@dataclass(frozen=True)
class ProviderCapabilities:
    reference_images: bool = False
    negative_prompt: bool = True
    seed: bool = False
    max_batch: int = 1


@dataclass
class ImageResult:
    image_bytes: list[bytes]
    seed: int | None = None
    meta: dict = field(default_factory=dict)


class ImageProvider(ABC):
    name: str = "abstract"
    label: str = "Abstract"
    model: str = ""
    capabilities: ProviderCapabilities = ProviderCapabilities()
    api_key: str = ""

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 1024,
        height: int = 1024,
        image_count: int = 1,
        reference_images: list[str] | None = None,
        seed: int | None = None,
    ) -> ImageResult:
        ...

    def info(self) -> dict:
        return {
            "id": self.name,
            "label": self.label,
            "model": self.model,
            "configured": self.available,
            "capabilities": self.capabilities.__dict__,
        }


def b64_to_bytes(payload: str) -> bytes:
    return base64.b64decode(payload.encode("ascii"))
`,
  },
  {
    path: "app/providers/openai_provider.py",
    language: "python",
    code: `"""OpenAI Images adapter (gpt-image-1).

Text-to-image: POST /v1/images/generations
With reference images: POST /v1/images/edits (image conditioning).
gpt-image-1 has no negative_prompt and no seed — the composer folds
restrictions into the prompt instead, and the engine drops seeds with
a capability warning rather than pretending they work.
"""
from __future__ import annotations

import io

import httpx

from app.providers.base import (
    ImageProvider,
    ImageResult,
    ProviderCapabilities,
    ProviderError,
    b64_to_bytes,
)

API_BASE = "https://api.openai.com/v1"


def _size(width: int, height: int) -> str:
    if width == height:
        return "1024x1024"
    return "1536x1024" if width > height else "1024x1536"


class OpenAIProvider(ImageProvider):
    name = "openai"
    label = "OpenAI Images"
    model = "gpt-image-1"
    capabilities = ProviderCapabilities(reference_images=True, negative_prompt=False, seed=False, max_batch=1)

    def __init__(self, api_key: str, timeout: float = 120.0):
        self.api_key = api_key
        self.timeout = timeout

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 1024,
        height: int = 1024,
        image_count: int = 1,
        reference_images: list[str] | None = None,
        seed: int | None = None,
    ) -> ImageResult:
        if not self.api_key:
            raise ProviderError.auth(self.name)

        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                if reference_images:
                    # images/edits accepts image conditioning inputs
                    files = []
                    for i, url in enumerate(reference_images):
                        data = await self._fetch_bytes(client, url)
                        files.append(("image[]", (f"ref-{i}.png", io.BytesIO(data), "image/png")))
                    resp = await client.post(
                        f"{API_BASE}/images/edits",
                        headers=headers,
                        data={"model": self.model, "prompt": prompt, "size": _size(width, height)},
                        files=files,
                    )
                else:
                    resp = await client.post(
                        f"{API_BASE}/images/generations",
                        headers=headers,
                        json={"model": self.model, "prompt": prompt, "size": _size(width, height), "n": image_count},
                    )
            except httpx.TimeoutException:
                raise ProviderError.timeout(self.name)
            except httpx.HTTPError:
                raise ProviderError.unavailable(self.name)

        if resp.status_code in (401, 403):
            raise ProviderError.auth(self.name)
        if resp.status_code == 429:
            raise ProviderError.rate_limit(self.name, resp.headers.get("retry-after"))
        if resp.status_code == 400:
            detail = resp.json().get("error", {}).get("message", "bad request")
            raise ProviderError.invalid_prompt(self.name, detail)
        if resp.status_code >= 500:
            raise ProviderError.unavailable(self.name)
        if resp.status_code != 200:
            raise ProviderError("GENERATION_FAILED", f"openai: HTTP {resp.status_code}", True)

        payload = resp.json()
        images = [b64_to_bytes(item["b64_json"]) for item in payload.get("data", []) if item.get("b64_json")]
        if not images:
            raise ProviderError("GENERATION_FAILED", "openai: response contained no image payload.", True)
        return ImageResult(image_bytes=images, seed=None, meta={"model": self.model})

    async def _fetch_bytes(self, client: httpx.AsyncClient, url: str) -> bytes:
        if not url.startswith(("http://", "https://")):
            raise ProviderError.invalid_prompt(self.name, "reference image must be an http(s) URL")
        r = await client.get(url)
        if r.status_code != 200:
            raise ProviderError("PROVIDER_INVALID_IMAGE", f"openai: could not fetch reference image {url}", False, 422)
        if len(r.content) > 12 * 1024 * 1024:
            raise ProviderError("PROVIDER_INVALID_IMAGE", "openai: reference image exceeds 12MB limit.", False, 422)
        return r.content
`,
  },
  {
    path: "app/providers/stability_provider.py",
    language: "python",
    code: `"""Stability AI adapter (SD 3.5 Large, text-to-image).

POST https://api.stability.ai/v2beta/stable-image/generate/sd3
multipart form; supports negative_prompt and seed natively.
No reference-image conditioning on this endpoint — engine warns.
"""
from __future__ import annotations

import httpx

from app.providers.base import (
    ImageProvider,
    ImageResult,
    ProviderCapabilities,
    ProviderError,
    b64_to_bytes,
)

ENDPOINT = "https://api.stability.ai/v2beta/stable-image/generate/sd3"


def _ratio(width: int, height: int) -> str:
    table = {(1024, 1024): "1:1", (1536, 1024): "3:2", (1024, 1536): "2:3", (1280, 960): "16:9", (960, 1280): "9:16"}
    return table.get((width, height), "16:9" if width > height else "9:16" if width < height else "1:1")


class StabilityProvider(ImageProvider):
    name = "stability"
    label = "Stability AI"
    model = "sd3.5-large"
    capabilities = ProviderCapabilities(reference_images=False, negative_prompt=True, seed=True, max_batch=1)

    def __init__(self, api_key: str, timeout: float = 120.0):
        self.api_key = api_key
        self.timeout = timeout

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 1024,
        height: int = 1024,
        image_count: int = 1,
        reference_images: list[str] | None = None,
        seed: int | None = None,
    ) -> ImageResult:
        if not self.api_key:
            raise ProviderError.auth(self.name)

        data = {
            "prompt": prompt,
            "model": self.model,
            "mode": "text-to-image",
            "aspect_ratio": _ratio(width, height),
            "output_format": "png",
        }
        if negative_prompt:
            data["negative_prompt"] = negative_prompt
        if seed is not None:
            data["seed"] = str(seed)

        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(ENDPOINT, headers=headers, data=data)
            except httpx.TimeoutException:
                raise ProviderError.timeout(self.name)
            except httpx.HTTPError:
                raise ProviderError.unavailable(self.name)

        if resp.status_code in (401, 403):
            raise ProviderError.auth(self.name)
        if resp.status_code == 429:
            raise ProviderError.rate_limit(self.name, resp.headers.get("retry-after"))
        if resp.status_code == 400:
            errors = resp.json().get("errors", ["bad request"])
            raise ProviderError.invalid_prompt(self.name, "; ".join(errors))
        if resp.status_code >= 500:
            raise ProviderError.unavailable(self.name)
        if resp.status_code != 200:
            raise ProviderError("GENERATION_FAILED", f"stability: HTTP {resp.status_code}", True)

        payload = resp.json()
        image = payload.get("image")
        if not image:
            raise ProviderError("GENERATION_FAILED", "stability: no image in response.", True)
        return ImageResult(
            image_bytes=[b64_to_bytes(image)],
            seed=payload.get("seed"),
            meta={"model": self.model, "finish_reason": payload.get("finish_reason", "")},
        )
`,
  },
  {
    path: "app/providers/flux_provider.py",
    language: "python",
    code: `"""Black Forest Labs adapter (FLUX 1.1 Pro).

Async task API: POST /v1/flux-pro-1.1 returns an id; poll
GET /v1/get_result until Ready. The sampled image URL is temporary —
run_generation persists bytes into engine storage immediately.
Supports seed; no negative prompt, no reference conditioning.
"""
from __future__ import annotations

import asyncio

import httpx

from app.providers.base import ImageProvider, ImageResult, ProviderCapabilities, ProviderError

SUBMIT = "https://api.bfl.ml/v1/flux-pro-1.1"
RESULT = "https://api.bfl.ml/v1/get_result"


class FluxProvider(ImageProvider):
    name = "flux"
    label = "Black Forest Labs"
    model = "flux-pro-1.1"
    capabilities = ProviderCapabilities(reference_images=False, negative_prompt=False, seed=True, max_batch=1)

    def __init__(self, api_key: str, timeout: float = 120.0):
        self.api_key = api_key
        self.timeout = timeout

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 1024,
        height: int = 1024,
        image_count: int = 1,
        reference_images: list[str] | None = None,
        seed: int | None = None,
    ) -> ImageResult:
        if not self.api_key:
            raise ProviderError.auth(self.name)

        headers = {"x-key": self.api_key, "Content-Type": "application/json"}
        body: dict = {"prompt": prompt, "width": width, "height": height, "safety_tolerance": 2}
        if seed is not None:
            body["seed"] = seed

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(SUBMIT, headers=headers, json=body)
            except httpx.TimeoutException:
                raise ProviderError.timeout(self.name)
            except httpx.HTTPError:
                raise ProviderError.unavailable(self.name)

            if resp.status_code in (401, 403):
                raise ProviderError.auth(self.name)
            if resp.status_code == 429:
                raise ProviderError.rate_limit(self.name, resp.headers.get("retry-after"))
            if resp.status_code == 422:
                raise ProviderError.invalid_prompt(self.name, resp.text[:300])
            if resp.status_code != 200:
                raise ProviderError.unavailable(self.name)

            task_id = resp.json()["id"]
            deadline = asyncio.get_event_loop().time() + self.timeout

            while asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(1.5)
                poll = await client.get(RESULT, headers=headers, params={"id": task_id})
                payload = poll.json()
                status = payload.get("status")
                if status == "Ready":
                    sample = payload["result"]["sample"]
                    img = await client.get(sample)
                    if img.status_code != 200:
                        raise ProviderError("GENERATION_FAILED", "flux: could not download sampled image.", True)
                    return ImageResult(
                        image_bytes=[img.content],
                        seed=payload["result"].get("seed"),
                        meta={"model": self.model, "task_id": task_id},
                    )
                if status in ("Error", "Failed"):
                    raise ProviderError("GENERATION_FAILED", f"flux: task failed — {payload.get('error', 'unknown')}", True)
                if status == "Content Moderated":
                    raise ProviderError.invalid_prompt(self.name, "content moderated")

        raise ProviderError.timeout(self.name)
`,
  },
  {
    path: "app/providers/mock_provider.py",
    language: "python",
    code: `"""Deterministic mock renderer.

The engine's zero-cost default: renders a branded SVG 'frame' derived
from the prompt hash, supports every capability, and keeps the whole
pipeline testable offline — API, queue, retries, storage and history
all behave exactly as with a paid provider.
"""
from __future__ import annotations

import asyncio
import hashlib
import random

from app.providers.base import ImageProvider, ImageResult, ProviderCapabilities

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>"
    "<stop offset='0' stop-color='hsl({h1},45%,14%)'/><stop offset='1' stop-color='hsl({h2},55%,26%)'/>"
    "</linearGradient></defs>"
    "<rect width='{w}' height='{h}' fill='url(#g)'/>"
    "<rect x='24' y='24' width='{fw}' height='{fh}' fill='none' stroke='rgba(255,255,255,0.35)' stroke-width='3'/>"
    "<circle cx='{px}' cy='{py}' r='{pr}' fill='rgba(255,255,255,0.16)'/>"
    "<text x='48' y='{t1}' font-family='monospace' font-size='30' fill='#EEF2EA'>BRYME MOCK RENDER</text>"
    "<text x='48' y='{t2}' font-family='monospace' font-size='18' fill='#9FE8C2'>seed {seed} · deterministic</text>"
    "<text x='48' y='{t3}' font-family='monospace' font-size='14' fill='rgba(238,242,234,0.6)'>{frag}…</text>"
    "</svg>"
)


class MockProvider(ImageProvider):
    name = "mock"
    label = "BRYME Mock Renderer"
    model = "bryme/mock-renderer-1"
    capabilities = ProviderCapabilities(reference_images=True, negative_prompt=True, seed=True, max_batch=4)

    def __init__(self, latency: float = 0.4, fail_first_n: int = 0):
        self.api_key = "mock"  # always configured
        self.latency = latency
        self._fail_first_n = fail_first_n
        self._calls = 0

    async def generate(
        self,
        prompt: str,
        negative_prompt: str | None = None,
        width: int = 1024,
        height: int = 1024,
        image_count: int = 1,
        reference_images: list[str] | None = None,
        seed: int | None = None,
    ) -> ImageResult:
        from app.providers.base import ProviderError

        digest = int(hashlib.sha256(prompt.encode()).hexdigest(), 16)
        # deterministic transient failure injection for retry tests:
        # the next _fail_first_n calls raise a retryable 429.
        if self._calls < self._fail_first_n:
            self._calls += 1
            raise ProviderError.rate_limit(self.name, retry_after="1")

        await asyncio.sleep(self.latency)
        rng = random.Random(digest + (seed or 0))
        resolved_seed = seed if seed is not None else digest % (2**31)
        frames = []
        for _ in range(max(1, image_count)):
            svg = SVG.format(
                w=width, h=height, fw=width - 48, fh=height - 48,
                h1=rng.randint(90, 160), h2=rng.randint(190, 240),
                px=rng.randint(width // 4, 3 * width // 4), py=rng.randint(height // 4, 3 * height // 4),
                pr=rng.randint(40, 160),
                t1=height - 96, t2=height - 60, t3=height - 32,
                seed=resolved_seed, frag=prompt[:80].replace("<", " ").replace(">", " "),
            )
            frames.append(svg.encode("utf-8"))
        return ImageResult(image_bytes=frames, seed=resolved_seed, meta={"model": self.model})
`,
  },
  {
    path: "app/storage/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/storage/base.py",
    language: "python",
    code: `"""Storage abstraction.

The engine never keeps a provider's temporary URL. Generated bytes are
persisted through ImageStorage immediately and panels reference our
own URLs. Dev writes to disk; production swaps in object storage by
configuration — the interface is the same.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class StoredImage:
    key: str
    url: str
    content_type: str
    size_bytes: int


class ImageStorage(ABC):
    @abstractmethod
    async def save(self, data: bytes, ext: str, content_type: str = "image/png") -> StoredImage:
        ...

    @abstractmethod
    async def delete(self, key: str) -> None:
        ...

    @abstractmethod
    def get_url(self, key: str) -> str:
        ...


def build_storage():
    from app.config import get_settings
    from app.storage.local import LocalStorage

    settings = get_settings()
    if settings.storage_backend == "local":
        return LocalStorage(settings.storage_dir, f"{settings.public_base_url}/images")
    raise ValueError(f"Unsupported STORAGE_BACKEND: {settings.storage_backend}")
`,
  },
  {
    path: "app/storage/local.py",
    language: "python",
    code: `"""Local filesystem storage for development and self-hosted deploys."""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from app.providers.base import ProviderError
from app.storage.base import ImageStorage, StoredImage

MIME = {"png": "image/png", "jpg": "image/jpeg", "svg": "image/svg+xml", "webp": "image/webp"}


class LocalStorage(ImageStorage):
    def __init__(self, root: str, public_base: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base = public_base.rstrip("/")

    async def save(self, data: bytes, ext: str, content_type: str | None = None) -> StoredImage:
        if not data:
            raise ProviderError.storage("refusing to persist an empty payload")
        if len(data) > 30 * 1024 * 1024:
            raise ProviderError.storage("payload exceeds 30MB limit")
        key = f"{uuid.uuid4().hex}.{ext}"
        path = self.root / key
        try:
            await asyncio.to_thread(path.write_bytes, data)
        except OSError as exc:
            raise ProviderError.storage(f"write failed: {exc}")
        return StoredImage(
            key=key,
            url=self.get_url(key),
            content_type=content_type or MIME.get(ext, "application/octet-stream"),
            size_bytes=len(data),
        )

    async def delete(self, key: str) -> None:
        path = self.root / Path(key).name  # never trust key traversal
        if path.exists():
            await asyncio.to_thread(path.unlink)

    def get_url(self, key: str) -> str:
        return f"{self.public_base}/{Path(key).name}"
`,
  },
  {
    path: "app/workers/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/workers/queue.py",
    language: "python",
    code: `"""Lightweight async job queue.

A deliberate alternative to Celery for small deployments: an asyncio
queue with N worker coroutines. Concurrency is capped, statuses are
persisted per attempt (queued/processing/retrying/completed/failed/
cancelled), and retries with exponential backoff live in
generation_service.run_generation. Swap for Celery later without
touching the service layer — enqueue() is the only contract.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from app.providers.base import ImageProvider

log = logging.getLogger("bryme.queue")

ProcessFn = Callable[[str], Awaitable[None]]


class GenerationQueue:
    def __init__(
        self,
        process: ProcessFn,
        providers: dict[str, ImageProvider],
        concurrency: int = 2,
    ):
        self._process = process
        self.providers = providers
        self._concurrency = max(1, concurrency)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self.cancelled: set[str] = set()

    async def start(self) -> None:
        for i in range(self._concurrency):
            self._workers.append(asyncio.create_task(self._worker(i), name=f"bryme-worker-{i}"))
        log.info("queue started with %s workers", self._concurrency)

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()
        if self._workers:
            await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def enqueue(self, job_id: str) -> None:
        await self._queue.put(job_id)

    async def cancel(self, job_id: str) -> None:
        # queued jobs are discarded at pickup; running jobs check the
        # set between retry attempts.
        self.cancelled.add(job_id)

    def depth(self) -> int:
        return self._queue.qsize()

    async def _worker(self, index: int) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                if job_id in self.cancelled:
                    self.cancelled.discard(job_id)
                    log.info("worker %s discarded cancelled job %s", index, job_id)
                    continue
                await self._process(job_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("worker %s crashed on job %s", index, job_id)
            finally:
                self._queue.task_done()
`,
  },
]

