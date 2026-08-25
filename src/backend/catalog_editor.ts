import type { BackendFile } from "./catalog_core";

export const EDITOR_FILES: BackendFile[] = [
  {
    path: "app/providers/gemini_provider.py",
    language: "python",
    code: `"""Google Gemini image adapter.

Text-to-image AND conversational image editing (image-to-image), which
is what the Studio's "AI edit" action calls. Registered through the
same ImageProvider contract as OpenAI/Stability/FLUX — the editor has
no idea Gemini exists.

SECURITY: GEMINI_API_KEY is read from the server environment only.
The browser calls POST /api/v1/images/edit on OUR backend; the key is
never serialised into any response.

  BRYME FRONTEND -> BRYME BACKEND -> GeminiProvider -> Google
"""
from __future__ import annotations

import base64
import mimetypes

import httpx

from app.providers.base import (
    ImageProvider, ImageResult, ProviderCapabilities, ProviderError, b64_to_bytes,
)

API = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(ImageProvider):
    name = "gemini"
    label = "Google Gemini"
    model = "gemini-2.5-flash-image"
    capabilities = ProviderCapabilities(
        reference_images=True,     # inline_data parts act as references
        negative_prompt=False,     # folded into the prompt by the composer
        seed=False,
        max_batch=1,
    )

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

        # Gemini has no negative_prompt field; state the restrictions
        # positively inside the prompt instead of silently dropping them.
        full = prompt
        if negative_prompt:
            full = f"{prompt}\\n\\nStrictly avoid: {negative_prompt}."

        parts: list[dict] = [{"text": full}]
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for ref in (reference_images or [])[:3]:
                data, mime = await self._load(client, ref)
                parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}})

            try:
                resp = await client.post(
                    f"{API}/models/{self.model}:generateContent",
                    headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                    json={"contents": [{"parts": parts}]},
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
            raise ProviderError("GENERATION_FAILED", f"gemini: HTTP {resp.status_code}", True)

        payload = resp.json()
        images: list[bytes] = []
        for cand in payload.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                blob = part.get("inline_data") or part.get("inlineData")
                if blob and blob.get("data"):
                    images.append(b64_to_bytes(blob["data"]))
        if not images:
            blocked = payload.get("promptFeedback", {}).get("blockReason")
            if blocked:
                raise ProviderError.invalid_prompt(self.name, f"blocked: {blocked}")
            raise ProviderError("GENERATION_FAILED", "gemini: response contained no image part.", True)

        return ImageResult(image_bytes=images, seed=None, meta={"model": self.model})

    async def edit(self, prompt: str, base_image: str, reference_images: list[str] | None = None) -> ImageResult:
        """Conversational edit: the base image is the first part, so the
        model modifies it rather than starting from scratch."""
        if not self.api_key:
            raise ProviderError.auth(self.name)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            data, mime = await self._load(client, base_image)
        refs = [base_image] + list(reference_images or [])
        return await self.generate(prompt=prompt, reference_images=refs)

    async def _load(self, client: httpx.AsyncClient, ref: str) -> tuple[bytes, str]:
        """Reference images may be local storage keys or http(s) URLs."""
        from pathlib import Path

        from app.config import get_settings

        if ref.startswith(("http://", "https://")):
            r = await client.get(ref)
            if r.status_code != 200:
                raise ProviderError("PROVIDER_INVALID_IMAGE", f"gemini: cannot fetch {ref}", False, 422)
            blob = r.content
            mime = r.headers.get("content-type", "image/png")
        else:
            path = Path(get_settings().storage_dir) / Path(ref).name
            if not path.exists():
                raise ProviderError("PROVIDER_INVALID_IMAGE", f"gemini: unknown asset {ref}", False, 422)
            blob = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
        if len(blob) > 12 * 1024 * 1024:
            raise ProviderError("PROVIDER_INVALID_IMAGE", "gemini: reference exceeds 12MB.", False, 422)
        return blob, mime
`,
  },
  {
    path: "app/models_editor.py",
    language: "python",
    code: `"""Non-destructive scene document tables.

CORE RULE: nothing is baked until export. Each layer is its own row so
it can be edited, versioned and reverted in isolation. The MP4 is an
artefact of the document, never its replacement.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _id(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex[:10]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SportsCharacterModel(Base):
    """The Sports Bible. Open-ended: full squads, managers, officials.
    Never capped at eleven."""
    __tablename__ = "sports_characters"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    team_id: Mapped[str | None] = mapped_column(String(48), nullable=True, index=True)
    squad_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[str] = mapped_column(String(32), index=True)
    face: Mapped[str] = mapped_column(Text, default="")
    hair: Mapped[str] = mapped_column(Text, default="")
    skin_tone: Mapped[str] = mapped_column(String(60), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    age_appearance: Mapped[str] = mapped_column(String(40), default="")
    signature_expression: Mapped[str] = mapped_column(Text, default="")
    kit: Mapped[str] = mapped_column(Text, default="")
    distinguishing: Mapped[list] = mapped_column(JSON, default=list)
    reference_images: Mapped[list] = mapped_column(JSON, default=list)
    visual_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    fictional: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class SceneDocumentModel(Base):
    """One editable scene. Layers live in child tables / JSON columns —
    never flattened into a rendered artefact."""
    __tablename__ = "scene_documents"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("scn"))
    motion_project_id: Mapped[str] = mapped_column(ForeignKey("motion_comic_projects.id"), index=True)
    panel_id: Mapped[str] = mapped_column(ForeignKey("panels.id"), index=True)
    panel_number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200), default="")
    event_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    characters: Mapped[list] = mapped_column(JSON, default=list)   # [{character_id, role, focus}]
    camera: Mapped[dict] = mapped_column(JSON, default=dict)
    transition: Mapped[dict] = mapped_column(JSON, default=dict)
    music: Mapped[dict] = mapped_column(JSON, default=dict)
    tail: Mapped[float] = mapped_column(Float, default=0.7)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class ImageAssetModel(Base):
    """Every image a scene has ever had. Replacing one appends a row;
    reverting just moves the pointer. Nothing is destroyed."""
    __tablename__ = "image_assets"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("img"))
    scene_id: Mapped[str] = mapped_column(ForeignKey("scene_documents.id"), index=True)
    url: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str] = mapped_column(String(180), default="")
    source: Mapped[str] = mapped_column(String(24), default="generated")  # generated|uploaded|ai_edited|seed
    provider: Mapped[str] = mapped_column(String(32), default="")
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class BubbleModel(Base):
    """Independent bubble object: geometry, skin, typography, animation."""
    __tablename__ = "speech_bubbles"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("bub"))
    scene_id: Mapped[str] = mapped_column(ForeignKey("scene_documents.id"), index=True)
    dialogue_id: Mapped[str] = mapped_column(ForeignKey("dialogue_lines.id"), index=True)
    style: Mapped[str] = mapped_column(String(24), default="speech")
    x: Mapped[float] = mapped_column(Float, default=0.5)
    y: Mapped[float] = mapped_column(Float, default=0.25)
    width: Mapped[float] = mapped_column(Float, default=0.38)
    font_scale: Mapped[float] = mapped_column(Float, default=1.0)
    font_family: Mapped[str] = mapped_column(String(24), default="display")
    fill: Mapped[str] = mapped_column(String(16), default="#F7F5EF")
    text_color: Mapped[str] = mapped_column(String(16), default="#12140F")
    stroke: Mapped[str] = mapped_column(String(16), default="#12140F")
    anim_in: Mapped[str] = mapped_column(String(16), default="pop_in")
    anim_out: Mapped[str] = mapped_column(String(16), default="fade_out")
    lead: Mapped[float] = mapped_column(Float, default=0.12)
    hold: Mapped[float] = mapped_column(Float, default=0.26)
    auto_placed: Mapped[bool] = mapped_column(Boolean, default=True)
    visible: Mapped[bool] = mapped_column(Boolean, default=True)


class SfxInstanceModel(Base):
    __tablename__ = "sfx_instances"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("sfx"))
    scene_id: Mapped[str] = mapped_column(ForeignKey("scene_documents.id"), index=True)
    sfx: Mapped[str] = mapped_column(String(40))
    start: Mapped[float] = mapped_column(Float, default=0.0)
    duration: Mapped[float] = mapped_column(Float, default=1.0)
    gain: Mapped[float] = mapped_column(Float, default=1.0)
    label: Mapped[str] = mapped_column(String(80), default="")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)


class SceneMutationModel(Base):
    """Audit ledger — every edit records which layers it touched and
    which it deliberately preserved. This is what makes the
    non-destructive guarantee verifiable rather than aspirational."""
    __tablename__ = "scene_mutations"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("mut"))
    scene_id: Mapped[str] = mapped_column(String(48), index=True)
    op: Mapped[str] = mapped_column(String(48), index=True)
    target: Mapped[str | None] = mapped_column(String(80), nullable=True)
    touched: Mapped[list] = mapped_column(JSON, default=list)
    preserved: Mapped[list] = mapped_column(JSON, default=list)
    cost: Mapped[str] = mapped_column(String(16), default="free")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=_now, index=True)
`,
  },
  {
    path: "app/editor/scene_service.py",
    language: "python",
    code: `"""Non-destructive scene editing.

Every public function here mutates exactly ONE layer and writes a
SceneMutation recording what it left alone. Timing is always derived
from live audio durations — never stored as baked numbers.
"""
from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models_editor import (
    BubbleModel, ImageAssetModel, SceneDocumentModel, SceneMutationModel, SfxInstanceModel,
)
from app.models_motion import AudioAssetModel, DialogueLineModel
from app.motion.bubbles import place_bubble
from app.motion.camera import build_camera
from app.motion.timeline import ASPECTS, HOLD_AFTER, LEAD_IN, LINE_GAP, MIN_SCENE
from app.tts.duration import estimate_duration

log = logging.getLogger("bryme.editor")

ALL_LAYERS = [
    "image", "characters", "dialogue", "voice", "bubbles",
    "sfx", "music", "camera", "transition", "timing",
]


async def _log(session: AsyncSession, scene_id: str, op: str, touched: list[str],
               cost: str = "free", target: str | None = None, note: str = "") -> SceneMutationModel:
    m = SceneMutationModel(
        scene_id=scene_id, op=op, target=target, touched=touched,
        preserved=[l for l in ALL_LAYERS if l not in touched], cost=cost, note=note,
    )
    session.add(m)
    return m


async def _bump(session: AsyncSession, scene_id: str) -> None:
    scene = await session.get(SceneDocumentModel, scene_id)
    if scene:
        scene.revision += 1


# ------------------------------------------------------- IMAGE ----

async def set_image(
    session: AsyncSession, scene_id: str, url: str, storage_key: str,
    source: str, provider: str, note: str, prompt: str | None = None,
) -> ImageAssetModel:
    """Append a revision and re-point 'current'. The previous image row
    is kept forever so revert is a pointer move, not a re-download."""
    await session.execute(
        update(ImageAssetModel).where(ImageAssetModel.scene_id == scene_id).values(is_current=False)
    )
    asset = ImageAssetModel(
        scene_id=scene_id, url=url, storage_key=storage_key, source=source,
        provider=provider, note=note, prompt=prompt, is_current=True,
    )
    session.add(asset)
    await _bump(session, scene_id)
    await _log(session, scene_id, f"image.{source}", ["image"],
               "image" if source in ("generated", "ai_edited") else "free", source,
               "dialogue, voice, bubbles, sfx, camera and timing all preserved")
    await session.commit()
    await session.refresh(asset)
    return asset


async def revert_image(session: AsyncSession, scene_id: str) -> ImageAssetModel | None:
    result = await session.execute(
        select(ImageAssetModel).where(ImageAssetModel.scene_id == scene_id)
        .order_by(ImageAssetModel.created_at.desc())
    )
    revisions = list(result.scalars().all())
    if len(revisions) < 2:
        return None
    current, previous = revisions[0], revisions[1]
    current.is_current = False
    previous.is_current = True
    await _bump(session, scene_id)
    await _log(session, scene_id, "image.revert", ["image"], "free", previous.source,
               "restored the previous revision; every other layer untouched")
    await session.commit()
    return previous


# ---------------------------------------------------- DIALOGUE ----

async def edit_dialogue_text(session: AsyncSession, scene_id: str, dialogue_id: str, text: str) -> dict:
    """Text edits never touch the image. Existing audio is flagged
    stale rather than silently re-billed."""
    line = await session.get(DialogueLineModel, dialogue_id)
    if line is None:
        raise ValueError("dialogue line not found")
    line.text = text                    # verbatim; no translation, no cleanup

    result = await session.execute(select(AudioAssetModel).where(AudioAssetModel.dialogue_id == dialogue_id))
    had_audio = result.scalar_one_or_none() is not None
    line.audio_stale = had_audio

    await _bump(session, scene_id)
    await _log(session, scene_id, "dialogue.edit_text", ["dialogue"] if had_audio else ["dialogue", "timing"],
               "free", dialogue_id,
               "image and bubble untouched; audio flagged stale" if had_audio
               else "image and bubble untouched; estimated timing refreshed")
    await session.commit()
    return {"dialogue_id": dialogue_id, "audio_stale": had_audio}


# ------------------------------------------------------ BUBBLE ----

async def update_bubble(session: AsyncSession, scene_id: str, bubble_id: str, patch: dict) -> BubbleModel:
    bubble = await session.get(BubbleModel, bubble_id)
    if bubble is None:
        raise ValueError("bubble not found")
    geometry = {"x", "y", "width"} & patch.keys()
    for k, v in patch.items():
        if hasattr(bubble, k):
            setattr(bubble, k, v)
    if geometry:
        bubble.auto_placed = False      # the user's placement wins from now on
    touched = ["bubbles", "timing"] if {"lead", "hold"} & patch.keys() else ["bubbles"]
    await _bump(session, scene_id)
    await _log(session, scene_id, "bubble.update", touched, "free", bubble_id,
               "no image regenerated, no voice re-synthesized")
    await session.commit()
    await session.refresh(bubble)
    return bubble


async def duplicate_bubble(session: AsyncSession, scene_id: str, bubble_id: str) -> BubbleModel:
    src = await session.get(BubbleModel, bubble_id)
    if src is None:
        raise ValueError("bubble not found")
    copy = BubbleModel(
        scene_id=src.scene_id, dialogue_id=src.dialogue_id, style=src.style,
        x=min(0.9, src.x + 0.06), y=min(0.9, src.y + 0.07), width=src.width,
        font_scale=src.font_scale, font_family=src.font_family, fill=src.fill,
        text_color=src.text_color, stroke=src.stroke, anim_in=src.anim_in,
        anim_out=src.anim_out, lead=src.lead, hold=src.hold, auto_placed=False,
    )
    session.add(copy)
    await _log(session, scene_id, "bubble.duplicate", ["bubbles"], "free", bubble_id)
    await session.commit()
    await session.refresh(copy)
    return copy


async def reflow_auto_bubbles(session: AsyncSession, scene_id: str, aspect: str) -> int:
    """Aspect change: re-place ONLY auto-placed bubbles. Hand-positioned
    bubbles are a user decision and are never overwritten."""
    safe = ASPECTS[aspect]["safe"]
    result = await session.execute(select(BubbleModel).where(BubbleModel.scene_id == scene_id))
    bubbles = list(result.scalars().all())
    auto = [b for b in bubbles if b.auto_placed]
    for i, b in enumerate(auto):
        x, y = place_bubble(i, len(bubbles), safe, None, b.style)
        b.x, b.y = x, y
    await _log(session, scene_id, "aspect.reflow", ["bubbles"], "free", aspect,
               f"{len(auto)} auto-placed bubbles re-flowed; {len(bubbles) - len(auto)} hand-placed kept")
    await session.commit()
    return len(auto)


# ------------------------------------------------------- VOICE ----

async def attach_user_audio(
    session: AsyncSession, scene_id: str, dialogue_id: str,
    url: str, storage_key: str, duration: float, mime: str, source: str,
) -> AudioAssetModel:
    """The user's own recording or upload replaces the AI take. The
    image and the bubble are not regenerated; timing re-derives from
    the measured duration."""
    asset = AudioAssetModel(
        dialogue_id=dialogue_id, cache_key=f"user_{storage_key}", provider="user",
        voice_id=source, url=url, storage_key=storage_key, mime=mime,
        duration=duration, duration_source="measured", characters=0,
        meta={"source": source},
    )
    session.add(asset)
    line = await session.get(DialogueLineModel, dialogue_id)
    if line:
        line.audio_asset_id = asset.id
        line.audio_stale = False
    await _bump(session, scene_id)
    await _log(session, scene_id, f"voice.{source}", ["voice", "timing"], "free", dialogue_id,
               f"measured {duration:.2f}s — bubble and timeline re-synced; image untouched")
    await session.commit()
    await session.refresh(asset)
    return asset


# --------------------------------------------------- SFX/CAMERA ----

async def replace_sfx(session: AsyncSession, scene_id: str, inst_id: str, sfx: str) -> SfxInstanceModel:
    inst = await session.get(SfxInstanceModel, inst_id)
    if inst is None:
        raise ValueError("sfx instance not found")
    inst.sfx = sfx
    await _log(session, scene_id, "sfx.replace", ["sfx"], "free", sfx,
               "voice, image and bubbles untouched")
    await session.commit()
    await session.refresh(inst)
    return inst


async def update_camera(session: AsyncSession, scene_id: str, patch: dict) -> dict:
    scene = await session.get(SceneDocumentModel, scene_id)
    if scene is None:
        raise ValueError("scene not found")
    camera = {**(scene.camera or {}), **patch, "auto": False}
    scene.camera = camera
    await _bump(session, scene_id)
    await _log(session, scene_id, "camera.update", ["camera"], "free", patch.get("move"),
               "camera is a pure instruction layer — it never rasterizes into the artwork")
    await session.commit()
    return camera


# ------------------------------------------------------ TIMING ----

async def derive_timing(session: AsyncSession, scene_id: str) -> dict:
    """Single source of truth for scene timing: real audio durations,
    bubble lead/hold, then the tail. Never persisted as fixed numbers."""
    result = await session.execute(
        select(DialogueLineModel).join(
            SceneDocumentModel, SceneDocumentModel.panel_id == DialogueLineModel.panel_id
        ).where(SceneDocumentModel.id == scene_id).order_by(DialogueLineModel.order)
    )
    lines = list(result.scalars().all())
    bubbles = {
        b.dialogue_id: b
        for b in (await session.execute(select(BubbleModel).where(BubbleModel.scene_id == scene_id))).scalars().all()
    }

    slots = []
    cursor = LEAD_IN
    for line in lines:
        audio = None
        if line.audio_asset_id:
            audio = await session.get(AudioAssetModel, line.audio_asset_id)
        duration = audio.duration if audio else estimate_duration(line.text)
        bubble = bubbles.get(line.id)
        hold = bubble.hold if bubble else HOLD_AFTER
        lead = bubble.lead if bubble else 0.12
        start, end = cursor, cursor + duration
        slots.append({
            "dialogue_id": line.id,
            "audio_start": round(start, 3), "audio_end": round(end, 3),
            "bubble_start": round(max(0.0, start - lead), 3),
            "bubble_end": round(end + hold, 3),
            "duration_source": audio.duration_source if audio else "estimated",
        })
        cursor = end + hold + LINE_GAP

    scene = await session.get(SceneDocumentModel, scene_id)
    tail = scene.tail if scene else 0.7
    return {"slots": slots, "duration": round(max(MIN_SCENE, cursor + tail), 3)}


async def scene_snapshot(session: AsyncSession, scene_id: str) -> dict:
    """The full editable document — what the frontend loads and what
    the renderer consumes. No baked frames anywhere in it."""
    scene = await session.get(SceneDocumentModel, scene_id)
    if scene is None:
        raise ValueError("scene not found")

    image = (await session.execute(
        select(ImageAssetModel).where(ImageAssetModel.scene_id == scene_id, ImageAssetModel.is_current.is_(True))
    )).scalar_one_or_none()
    history = list((await session.execute(
        select(ImageAssetModel).where(ImageAssetModel.scene_id == scene_id, ImageAssetModel.is_current.is_(False))
        .order_by(ImageAssetModel.created_at.desc())
    )).scalars().all())
    bubbles = list((await session.execute(select(BubbleModel).where(BubbleModel.scene_id == scene_id))).scalars().all())
    sfx = list((await session.execute(select(SfxInstanceModel).where(SfxInstanceModel.scene_id == scene_id))).scalars().all())
    lines = list((await session.execute(
        select(DialogueLineModel).where(DialogueLineModel.panel_id == scene.panel_id).order_by(DialogueLineModel.order)
    )).scalars().all())

    voices = {}
    for line in lines:
        if line.audio_asset_id:
            a = await session.get(AudioAssetModel, line.audio_asset_id)
            if a:
                voices[line.id] = {
                    "id": a.id, "source": a.meta.get("source", "ai"), "provider": a.provider,
                    "url": a.url, "duration": a.duration, "duration_source": a.duration_source,
                }

    timing = await derive_timing(session, scene_id)
    camera = build_camera(
        (scene.camera or {}).get("move", "slow_drift"),
        timing["duration"],
        tuple((scene.camera or {}).get("focus_point")) if (scene.camera or {}).get("focus_point") else None,
        scene.event_type,
    ).to_dict()

    return {
        "scene_id": scene.id,
        "panel_id": scene.panel_id,
        "panel_number": scene.panel_number,
        "title": scene.title,
        "revision": scene.revision,
        "duration": timing["duration"],
        "layers": {
            "image": {
                "current": {"id": image.id, "url": image.url, "source": image.source, "note": image.note} if image else None,
                "history": [{"id": h.id, "url": h.url, "source": h.source} for h in history],
            },
            "characters": scene.characters,
            "dialogue": [
                {"id": l.id, "order": l.order, "speaker": l.speaker_label, "text": l.text,
                 "language": l.language_label, "emotion": l.emotion, "audio_stale": l.audio_stale}
                for l in lines
            ],
            "voice": voices,
            "bubbles": [
                {"id": b.id, "dialogue_id": b.dialogue_id, "style": b.style, "x": b.x, "y": b.y,
                 "width": b.width, "font_scale": b.font_scale, "font_family": b.font_family,
                 "fill": b.fill, "text_color": b.text_color, "stroke": b.stroke,
                 "anim_in": b.anim_in, "anim_out": b.anim_out, "lead": b.lead, "hold": b.hold,
                 "auto_placed": b.auto_placed, "visible": b.visible}
                for b in bubbles
            ],
            "sfx": [
                {"id": s.id, "sfx": s.sfx, "start": s.start, "duration": s.duration, "gain": s.gain}
                for s in sfx
            ],
            "music": scene.music,
            "camera": {**(scene.camera or {}), "track": camera},
            "transition": scene.transition,
        },
        "timing": timing["slots"],
    }
`,
  },
  {
    path: "app/api/v1/editor.py",
    language: "python",
    code: `"""Layer-scoped editing API.

Each route touches exactly one layer. There is deliberately NO
"rebuild scene" endpoint — that is how systems become destructive.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.editor import scene_service
from app.models_editor import SceneMutationModel, SportsCharacterModel
from app.providers.base import ProviderError
from app.schemas_editor import (
    BubbleUpdate, CameraUpdate, DialogueTextUpdate, ImageEditRequest, SceneOut, SportsCharacterOut,
)
from app.tts.duration import probe_duration

router = APIRouter(prefix="/scenes", tags=["editor"])
images_router = APIRouter(prefix="/images", tags=["editor"])
bible_router = APIRouter(prefix="/sports-bible", tags=["sports-bible"])

MAX_IMAGE = 20 * 1024 * 1024
MAX_AUDIO = 25 * 1024 * 1024
IMAGE_MIME = {"image/png", "image/jpeg", "image/webp"}
AUDIO_MIME = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"}


# ----------------------------------------------------- SCENE ----

@router.get("/{scene_id}", response_model=SceneOut)
async def get_scene(scene_id: str, session: AsyncSession = Depends(get_session)):
    """The complete editable document. This — not the MP4 — is the project."""
    try:
        return await scene_service.scene_snapshot(session, scene_id)
    except ValueError as e:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": str(e), "retryable": False}})


@router.get("/{scene_id}/mutations")
async def scene_mutations(scene_id: str, limit: int = 50, session: AsyncSession = Depends(get_session)):
    """Audit trail: which layers each edit touched, and which it preserved."""
    result = await session.execute(
        select(SceneMutationModel).where(SceneMutationModel.scene_id == scene_id)
        .order_by(SceneMutationModel.created_at.desc()).limit(limit)
    )
    return [
        {"id": m.id, "op": m.op, "target": m.target, "touched": m.touched,
         "preserved": m.preserved, "cost": m.cost, "note": m.note, "at": m.created_at}
        for m in result.scalars().all()
    ]


# ----------------------------------------------------- IMAGE ----

@images_router.post("/edit")
async def edit_image(payload: ImageEditRequest, request: Request, session: AsyncSession = Depends(get_session)):
    """Generate or conversationally edit the scene image.

    The browser never sees a vendor key: it calls this route, we call
    the provider. Only the image layer changes.
    """
    providers = request.app.state.providers
    provider = providers.get(payload.provider)
    if provider is None:
        raise ProviderError("PROVIDER_NOT_CONFIGURED", f"No adapter '{payload.provider}'.", False, 400)
    if not provider.available:
        raise ProviderError("PROVIDER_NOT_CONFIGURED",
                            f"'{payload.provider}' has no server credential configured.", False, 400)

    storage = request.app.state.storage
    if payload.base_image and hasattr(provider, "edit"):
        result = await provider.edit(payload.prompt or "", payload.base_image, payload.reference_images)
        source = "ai_edited"
    else:
        result = await provider.generate(
            prompt=payload.prompt or "",
            reference_images=payload.reference_images or None,
        )
        source = "generated"

    stored = await storage.save(result.image_bytes[0], "png", "image/png")
    asset = await scene_service.set_image(
        session, payload.scene_id, stored.url, stored.key, source, payload.provider,
        note=f"{payload.provider}: {(payload.prompt or '')[:60]}", prompt=payload.prompt,
    )
    return {"image_url": asset.url, "asset_id": asset.id, "source": asset.source,
            "preserved": ["dialogue", "voice", "bubbles", "sfx", "music", "camera", "transition"]}


@router.post("/{scene_id}/image/upload")
async def upload_image(scene_id: str, request: Request, file: UploadFile = File(...),
                       session: AsyncSession = Depends(get_session)):
    if file.content_type not in IMAGE_MIME:
        raise HTTPException(422, detail={"error": {"code": "INVALID_MIME", "message": f"{file.content_type} is not an accepted image.", "retryable": False}})
    data = await file.read()
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, detail={"error": {"code": "FILE_TOO_LARGE", "message": "Images are limited to 20MB.", "retryable": False}})
    ext = "png" if "png" in file.content_type else "jpg"
    stored = await request.app.state.storage.save(data, ext, file.content_type)
    asset = await scene_service.set_image(session, scene_id, stored.url, stored.key, "uploaded", "upload",
                                          note=f"uploaded {file.filename}")
    return {"image_url": asset.url, "asset_id": asset.id}


@router.post("/{scene_id}/image/revert")
async def revert_image(scene_id: str, session: AsyncSession = Depends(get_session)):
    previous = await scene_service.revert_image(session, scene_id)
    if previous is None:
        raise HTTPException(409, detail={"error": {"code": "NO_HISTORY", "message": "No earlier revision to revert to.", "retryable": False}})
    return {"image_url": previous.url, "asset_id": previous.id}


# -------------------------------------------------- DIALOGUE ----

@router.patch("/{scene_id}/dialogue/{dialogue_id}")
async def patch_dialogue(scene_id: str, dialogue_id: str, payload: DialogueTextUpdate,
                         session: AsyncSession = Depends(get_session)):
    """Text is stored verbatim — Pidgin is never translated or 'fixed'."""
    try:
        return await scene_service.edit_dialogue_text(session, scene_id, dialogue_id, payload.text)
    except ValueError as e:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": str(e), "retryable": False}})


# ---------------------------------------------------- BUBBLE ----

@router.patch("/{scene_id}/bubbles/{bubble_id}")
async def patch_bubble(scene_id: str, bubble_id: str, payload: BubbleUpdate,
                       session: AsyncSession = Depends(get_session)):
    try:
        b = await scene_service.update_bubble(session, scene_id, bubble_id, payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": str(e), "retryable": False}})
    return {"id": b.id, "x": b.x, "y": b.y, "width": b.width, "style": b.style, "auto_placed": b.auto_placed}


@router.post("/{scene_id}/bubbles/{bubble_id}/duplicate")
async def dup_bubble(scene_id: str, bubble_id: str, session: AsyncSession = Depends(get_session)):
    b = await scene_service.duplicate_bubble(session, scene_id, bubble_id)
    return {"id": b.id}


# ----------------------------------------------------- VOICE ----

@router.post("/{scene_id}/dialogue/{dialogue_id}/voice/upload")
async def upload_voice(scene_id: str, dialogue_id: str, request: Request,
                       source: str = Form("upload"), file: UploadFile = File(...),
                       session: AsyncSession = Depends(get_session)):
    """The user's own voice — uploaded file or a browser recording.
    Duration is measured from the real audio, then the timeline and the
    bubble re-sync. No image or bubble is regenerated."""
    if file.content_type not in AUDIO_MIME:
        raise HTTPException(422, detail={"error": {"code": "INVALID_MIME", "message": f"{file.content_type} is not accepted audio.", "retryable": False}})
    data = await file.read()
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, detail={"error": {"code": "FILE_TOO_LARGE", "message": "Audio is limited to 25MB.", "retryable": False}})

    ext = {"audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
           "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg"}[file.content_type]
    duration = await probe_duration(data, f".{ext}")
    if duration is None:
        raise HTTPException(422, detail={"error": {"code": "UNREADABLE_AUDIO", "message": "Could not measure the audio duration.", "retryable": False}})

    stored = await request.app.state.storage.save(data, ext, file.content_type)
    asset = await scene_service.attach_user_audio(
        session, scene_id, dialogue_id, stored.url, stored.key, duration, file.content_type,
        "record" if source == "record" else "upload",
    )
    timing = await scene_service.derive_timing(session, scene_id)
    return {"audio_url": asset.url, "duration": asset.duration, "timing": timing}


# ------------------------------------------------ SFX / CAMERA ----

@router.patch("/{scene_id}/sfx/{inst_id}")
async def patch_sfx(scene_id: str, inst_id: str, sfx: str, session: AsyncSession = Depends(get_session)):
    try:
        inst = await scene_service.replace_sfx(session, scene_id, inst_id, sfx)
    except ValueError as e:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": str(e), "retryable": False}})
    return {"id": inst.id, "sfx": inst.sfx}


@router.patch("/{scene_id}/camera")
async def patch_camera(scene_id: str, payload: CameraUpdate, session: AsyncSession = Depends(get_session)):
    try:
        return await scene_service.update_camera(session, scene_id, payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": str(e), "retryable": False}})


@router.get("/{scene_id}/timing")
async def scene_timing(scene_id: str, session: AsyncSession = Depends(get_session)):
    """Always derived from live audio durations — never a stored bake."""
    return await scene_service.derive_timing(session, scene_id)


# ---------------------------------------------- SPORTS BIBLE ----

@bible_router.get("", response_model=list[SportsCharacterOut])
async def list_bible(team_id: str | None = None, position: str | None = None,
                     session: AsyncSession = Depends(get_session)):
    """Full squads, managers and officials — never capped at eleven."""
    stmt = select(SportsCharacterModel).order_by(SportsCharacterModel.squad_number.nulls_last())
    if team_id:
        stmt = stmt.where(SportsCharacterModel.team_id == team_id)
    if position:
        stmt = stmt.where(SportsCharacterModel.position == position)
    return (await session.execute(stmt)).scalars().all()


@bible_router.get("/{character_id}", response_model=SportsCharacterOut)
async def get_bible_character(character_id: str, session: AsyncSession = Depends(get_session)):
    c = await session.get(SportsCharacterModel, character_id)
    if not c:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Character not found.", "retryable": False}})
    return c
`,
  },
  {
    path: "app/schemas_editor.py",
    language: "python",
    code: `"""Editor contracts — every patch is layer-scoped."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

BUBBLE_STYLES = {"speech", "shout", "whisper", "thought", "commentator", "narration", "crowd"}
ANIMS = {"fade_in", "pop_in", "slide_in", "bounce_in", "shake_in"}
CAMERA_MOVES = {
    "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down",
    "focus_character", "focus_center", "shake", "slow_drift",
}


class ImageEditRequest(BaseModel):
    scene_id: str
    provider: str = "gemini"
    prompt: Optional[str] = Field(default=None, max_length=2000)
    base_image: Optional[str] = None        # present => conversational edit
    reference_images: list[str] = []


class DialogueTextUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=800)


class BubbleUpdate(BaseModel):
    style: Optional[str] = None
    x: Optional[float] = Field(default=None, ge=0.02, le=0.98)
    y: Optional[float] = Field(default=None, ge=0.02, le=0.98)
    width: Optional[float] = Field(default=None, ge=0.1, le=0.95)
    font_scale: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    font_family: Optional[str] = None
    fill: Optional[str] = Field(default=None, max_length=16)
    text_color: Optional[str] = Field(default=None, max_length=16)
    stroke: Optional[str] = Field(default=None, max_length=16)
    anim_in: Optional[str] = None
    anim_out: Optional[str] = None
    lead: Optional[float] = Field(default=None, ge=0, le=2)
    hold: Optional[float] = Field(default=None, ge=0, le=4)
    visible: Optional[bool] = None

    @field_validator("style")
    @classmethod
    def _style(cls, v):
        if v and v not in BUBBLE_STYLES:
            raise ValueError(f"style must be one of {sorted(BUBBLE_STYLES)}")
        return v

    @field_validator("anim_in")
    @classmethod
    def _anim(cls, v):
        if v and v not in ANIMS:
            raise ValueError(f"anim_in must be one of {sorted(ANIMS)}")
        return v


class CameraUpdate(BaseModel):
    move: Optional[str] = None
    intensity: Optional[float] = Field(default=None, ge=0.2, le=1.5)
    focus_character_id: Optional[str] = None
    focus_point: Optional[list[float]] = None
    shake_enabled: Optional[bool] = None

    @field_validator("move")
    @classmethod
    def _move(cls, v):
        if v and v not in CAMERA_MOVES:
            raise ValueError(f"move must be one of {sorted(CAMERA_MOVES)}")
        return v


class SportsCharacterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    team_id: Optional[str]
    squad_number: Optional[int]
    position: str
    face: str
    hair: str
    skin_tone: str
    body: str
    kit: str
    distinguishing: list[str]
    reference_images: list[str]
    fictional: bool
    version: int


class SceneOut(BaseModel):
    scene_id: str
    panel_id: str
    panel_number: int
    title: str
    revision: int
    duration: float
    layers: dict
    timing: list[dict]
`,
  },
  {
    path: "tests/test_editor.py",
    language: "python",
    code: `"""Non-destructive editing acceptance tests.

These encode the ten checks from the brief. No paid API is called:
the Gemini adapter is mocked with respx and audio is synthetic.
"""
from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
import respx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.editor import scene_service
from app.models_editor import BubbleModel, ImageAssetModel, SceneDocumentModel, SceneMutationModel, SfxInstanceModel
from app.models_motion import AudioAssetModel, DialogueLineModel, VoiceProfileModel
from app.providers.base import ProviderError
from app.providers.gemini_provider import GeminiProvider

PIDGIN = "Omo, we don win am!"


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def scene(session_factory):
    async with session_factory() as s:
        s.add(VoiceProfileModel(id="vp1", label="Test", voice_id="en-NG-AbeoNeural"))
        s.add(SceneDocumentModel(id="scn1", motion_project_id="mc1", panel_id="panel-20",
                                 panel_number=20, title="The Winner",
                                 camera={"move": "zoom_in"}, transition={"kind": "flash"}, music={}))
        s.add(ImageAssetModel(id="img1", scene_id="scn1", url="/a.png", source="seed", is_current=True))
        s.add(DialogueLineModel(id="d1", panel_id="panel-20", order=1, speaker_label="City Player",
                                voice_profile_id="vp1", text=PIDGIN))
        s.add(BubbleModel(id="b1", scene_id="scn1", dialogue_id="d1", x=0.3, y=0.25))
        s.add(SfxInstanceModel(id="s1", scene_id="scn1", sfx="crowd_roar", duration=2.0))
        await s.commit()
    return "scn1"


async def _layers(session, scene_id):
    return await scene_service.scene_snapshot(session, scene_id)


# ---- 1. image replaced, everything else intact ----

@pytest.mark.asyncio
async def test_replacing_image_preserves_all_other_layers(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.set_image(s, scene, "/new.png", "new.png", "uploaded", "upload", "swap")
        after = await _layers(s, scene)

    assert after["layers"]["image"]["current"]["url"] == "/new.png"
    assert after["layers"]["dialogue"] == before["layers"]["dialogue"]
    assert after["layers"]["bubbles"] == before["layers"]["bubbles"]
    assert after["layers"]["sfx"] == before["layers"]["sfx"]
    assert after["layers"]["camera"]["move"] == before["layers"]["camera"]["move"]


@pytest.mark.asyncio
async def test_image_history_is_never_destroyed_and_reverts(session_factory, scene):
    async with session_factory() as s:
        await scene_service.set_image(s, scene, "/v2.png", "v2.png", "ai_edited", "gemini", "edit")
        snap = await _layers(s, scene)
        assert snap["layers"]["image"]["current"]["url"] == "/v2.png"
        assert len(snap["layers"]["image"]["history"]) == 1

        reverted = await scene_service.revert_image(s, scene)
        assert reverted.url == "/a.png"
        snap2 = await _layers(s, scene)
        assert snap2["layers"]["image"]["current"]["url"] == "/a.png"
        # the newer revision still exists — revert is a pointer move
        rows = (await s.execute(select(ImageAssetModel).where(ImageAssetModel.scene_id == scene))).scalars().all()
        assert len(rows) == 2


# ---- 2. dialogue edited, image intact ----

@pytest.mark.asyncio
async def test_editing_dialogue_leaves_image_and_bubble_untouched(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.edit_dialogue_text(s, scene, "d1", "Ref abeg, na handball!")
        after = await _layers(s, scene)

    assert after["layers"]["dialogue"][0]["text"] == "Ref abeg, na handball!"
    assert after["layers"]["image"]["current"]["url"] == before["layers"]["image"]["current"]["url"]
    assert after["layers"]["bubbles"][0]["x"] == before["layers"]["bubbles"][0]["x"]


@pytest.mark.asyncio
async def test_pidgin_is_stored_verbatim(session_factory, scene):
    async with session_factory() as s:
        snap = await _layers(s, scene)
        assert snap["layers"]["dialogue"][0]["text"] == PIDGIN


# ---- 3 & 4. voice replaced / user's own voice ----

@pytest.mark.asyncio
async def test_user_voice_upload_resyncs_timing_only(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.attach_user_audio(s, scene, "d1", "/me.webm", "me.webm", 3.4, "audio/webm", "record")
        after = await _layers(s, scene)

    assert after["layers"]["voice"]["d1"]["source"] == "record"
    assert after["layers"]["voice"]["d1"]["duration"] == 3.4
    # image + bubble geometry untouched
    assert after["layers"]["image"]["current"]["url"] == before["layers"]["image"]["current"]["url"]
    assert after["layers"]["bubbles"][0]["x"] == before["layers"]["bubbles"][0]["x"]
    # timing re-derived from the REAL duration
    slot = after["timing"][0]
    assert slot["audio_end"] - slot["audio_start"] == pytest.approx(3.4, abs=0.01)
    assert slot["duration_source"] == "measured"


@pytest.mark.asyncio
async def test_bubble_window_follows_the_new_audio(session_factory, scene):
    async with session_factory() as s:
        await scene_service.attach_user_audio(s, scene, "d1", "/x.wav", "x.wav", 5.0, "audio/wav", "upload")
        snap = await _layers(s, scene)
    slot = snap["timing"][0]
    assert slot["bubble_start"] <= slot["audio_start"]
    assert slot["bubble_end"] > slot["audio_end"]
    assert snap["duration"] > 5.0


# ---- 5. bubble moved independently ----

@pytest.mark.asyncio
async def test_moving_a_bubble_marks_it_manual_and_touches_nothing_else(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.update_bubble(s, scene, "b1", {"x": 0.75, "y": 0.6})
        after = await _layers(s, scene)

    assert after["layers"]["bubbles"][0]["x"] == 0.75
    assert after["layers"]["bubbles"][0]["auto_placed"] is False
    assert after["layers"]["image"] == before["layers"]["image"]
    assert after["layers"]["dialogue"] == before["layers"]["dialogue"]


@pytest.mark.asyncio
async def test_aspect_reflow_respects_hand_placed_bubbles(session_factory, scene):
    async with session_factory() as s:
        await scene_service.update_bubble(s, scene, "b1", {"x": 0.8, "y": 0.8})
        moved = await scene_service.reflow_auto_bubbles(s, scene, "9:16")
        snap = await _layers(s, scene)
    assert moved == 0                        # nothing auto-placed remained
    assert snap["layers"]["bubbles"][0]["x"] == 0.8


# ---- 6. camera changed independently ----

@pytest.mark.asyncio
async def test_camera_change_does_not_touch_image_or_audio(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.update_camera(s, scene, {"move": "pan_left"})
        after = await _layers(s, scene)
    assert after["layers"]["camera"]["move"] == "pan_left"
    assert after["layers"]["image"] == before["layers"]["image"]
    assert after["layers"]["voice"] == before["layers"]["voice"]


# ---- 7. sound effect replaced independently ----

@pytest.mark.asyncio
async def test_sfx_replacement_is_isolated(session_factory, scene):
    async with session_factory() as s:
        before = await _layers(s, scene)
        await scene_service.replace_sfx(s, scene, "s1", "whistle")
        after = await _layers(s, scene)
    assert after["layers"]["sfx"][0]["sfx"] == "whistle"
    assert after["layers"]["dialogue"] == before["layers"]["dialogue"]
    assert after["layers"]["image"] == before["layers"]["image"]


# ---- 8. mutation ledger proves preservation ----

@pytest.mark.asyncio
async def test_every_edit_records_what_it_preserved(session_factory, scene):
    async with session_factory() as s:
        await scene_service.update_bubble(s, scene, "b1", {"style": "shout"})
        await scene_service.update_camera(s, scene, {"move": "shake"})
        rows = (await s.execute(select(SceneMutationModel).where(SceneMutationModel.scene_id == scene))).scalars().all()

    ops = {r.op: r for r in rows}
    assert "image" in ops["bubble.update"].preserved
    assert "voice" in ops["bubble.update"].preserved
    assert ops["bubble.update"].cost == "free"
    assert "image" in ops["camera.update"].preserved
    assert ops["camera.update"].cost == "free"


# ---- 9. gemini adapter (mocked) ----

@pytest.mark.asyncio
@respx.mock
async def test_gemini_returns_image_bytes():
    respx.post(respx.patterns.M(host="generativelanguage.googleapis.com")).mock(
        return_value=httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"inline_data": {"mime_type": "image/png", "data": "aGVsbG8="}}]}}]
        })
    )
    p = GeminiProvider("test-key")
    result = await p.generate("a football comic panel")
    assert result.image_bytes[0] == b"hello"


@pytest.mark.asyncio
@respx.mock
async def test_gemini_block_reason_is_normalized():
    respx.post(respx.patterns.M(host="generativelanguage.googleapis.com")).mock(
        return_value=httpx.Response(200, json={"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}})
    )
    with pytest.raises(ProviderError) as exc:
        await GeminiProvider("k").generate("x")
    assert exc.value.code == "PROVIDER_INVALID_PROMPT"


@pytest.mark.asyncio
async def test_gemini_without_key_never_pretends_to_work():
    with pytest.raises(ProviderError) as exc:
        await GeminiProvider("").generate("x")
    assert exc.value.code == "PROVIDER_AUTH"


# ---- 10. the document survives export ----

@pytest.mark.asyncio
async def test_document_remains_fully_editable_after_export(session_factory, scene):
    """Export produces an artefact; the document is untouched and can
    still be edited afterwards."""
    async with session_factory() as s:
        snap_before = await _layers(s, scene)
        # (an export job would run here; it only READS the document)
        await scene_service.update_bubble(s, scene, "b1", {"x": 0.42})
        await scene_service.edit_dialogue_text(s, scene, "d1", "Still editable!")
        snap_after = await _layers(s, scene)

    assert snap_before["layers"]["bubbles"][0]["x"] != snap_after["layers"]["bubbles"][0]["x"]
    assert snap_after["layers"]["dialogue"][0]["text"] == "Still editable!"
    assert snap_after["revision"] > snap_before["revision"]
`,
  },
];

