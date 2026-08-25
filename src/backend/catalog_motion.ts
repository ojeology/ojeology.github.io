import type { BackendFile } from "./catalog_core";

export const MOTION_FILES: BackendFile[] = [
  /* ============================== TTS LAYER ============================== */
  {
    path: "app/tts/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/tts/base.py",
    language: "python",
    code: `"""Provider-agnostic text-to-speech.

Same shape as providers/base.py in the image engine: adapters declare
capabilities honestly and every failure is normalized. Nothing in the
motion layer talks to a vendor SDK directly.
"""
from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class TTSError(Exception):
    def __init__(self, code: str, message: str, retryable: bool, http_status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.http_status = http_status

    @classmethod
    def not_configured(cls, provider: str) -> "TTSError":
        return cls("TTS_NOT_CONFIGURED", f"{provider}: no API key configured.", False, 400)

    @classmethod
    def auth(cls, provider: str) -> "TTSError":
        return cls("TTS_AUTH", f"{provider}: API key rejected.", False, 502)

    @classmethod
    def rate_limit(cls, provider: str) -> "TTSError":
        return cls("TTS_RATE_LIMIT", f"{provider}: rate limit reached.", True, 429)

    @classmethod
    def timeout(cls, provider: str) -> "TTSError":
        return cls("TTS_TIMEOUT", f"{provider}: request timed out.", True, 504)

    @classmethod
    def invalid_text(cls, provider: str, detail: str) -> "TTSError":
        return cls("TTS_INVALID_TEXT", f"{provider}: {detail}", False, 422)

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable}}


@dataclass(frozen=True)
class TTSCapabilities:
    exact_duration: bool = True      # returns real audio, so length is measurable
    emotion: bool = False
    speed: bool = True
    pitch: bool = False
    ssml: bool = False
    nigerian_english_voices: bool = False
    # No mainstream vendor ships a Nigerian *Pidgin* locale. We never
    # claim one. Pidgin text is spoken verbatim by an en-NG voice.
    native_pidgin_locale: bool = False
    max_chars: int = 5000


@dataclass
class TTSResult:
    audio: bytes
    mime: str
    duration: float
    provider: str
    voice: str
    meta: dict = field(default_factory=dict)


class TTSProvider(ABC):
    name: str = "abstract"
    label: str = "Abstract"
    model: str = ""
    capabilities: TTSCapabilities = TTSCapabilities()
    api_key: str = ""

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @abstractmethod
    async def generate(
        self,
        text: str,
        voice: str,
        language: str,
        emotion: str | None = None,
        speed: float = 1.0,
        pitch: float = 1.0,
    ) -> TTSResult:
        ...

    def info(self) -> dict:
        return {
            "id": self.name,
            "label": self.label,
            "model": self.model,
            "configured": self.available,
            "capabilities": self.capabilities.__dict__,
        }


def voice_cache_key(text: str, voice: str, language: str, emotion: str | None, speed: float, pitch: float) -> str:
    """Identical requests must never bill twice — this is the cost gate."""
    raw = f"{text}|{voice}|{language}|{emotion or ''}|{speed:.2f}|{pitch:.2f}"
    return "tts_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]
`,
  },
  {
    path: "app/tts/duration.py",
    language: "python",
    code: `"""Audio duration measurement + estimation.

Timeline construction needs a length. Preference order:
  1. exact length probed from the rendered audio (ffprobe / wave)
  2. deterministic estimate from the text (only when a provider
     genuinely cannot return audio)
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import re
import wave

WPM_BY_EMOTION = {
    "calm": 150, "confident": 165, "playful": 170, "mocking": 158,
    "defiant": 172, "excited": 186, "energetic": 192, "roaring": 130,
    "angry": 180, "sad": 138,
}


def estimate_duration(text: str, speed: float = 1.0, emotion: str = "confident") -> float:
    words = len([w for w in text.strip().split() if w])
    wpm = WPM_BY_EMOTION.get(emotion, 165) * max(0.1, speed)
    base = (words / wpm) * 60
    base += len(re.findall(r"[,;:]", text)) * 0.16
    base += len(re.findall(r"[.!?]", text)) * 0.28
    base += len(re.findall(r"!", text)) * 0.06
    base += len(re.findall(r"…|\\.\\.\\.", text)) * 0.35
    base += len(re.findall(r"\\b[A-Z]{3,}\\b", text)) * 0.12
    return round(max(0.7, base), 3)


def wav_duration(data: bytes) -> float | None:
    with contextlib.suppress(Exception):
        with wave.open(io.BytesIO(data), "rb") as w:
            return round(w.getnframes() / float(w.getframerate()), 3)
    return None


async def probe_duration(data: bytes, suffix: str = ".mp3") -> float | None:
    """Exact length via ffprobe reading from stdin."""
    if suffix == ".wav":
        direct = wav_duration(data)
        if direct is not None:
            return direct
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-i", "pipe:0",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate(input=data)
    with contextlib.suppress(Exception):
        return round(float(json.loads(out)["format"]["duration"]), 3)
    return None
`,
  },
  {
    path: "app/tts/providers/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/tts/providers/elevenlabs_provider.py",
    language: "python",
    code: `"""ElevenLabs adapter.

POST /v1/text-to-speech/{voice_id} -> audio/mpeg bytes.
Expressive multilingual model; community library carries
Nigerian-accented English voices. There is no Pidgin locale —
capabilities say so, and the text is sent through untouched.
"""
from __future__ import annotations

import httpx

from app.tts.base import TTSCapabilities, TTSError, TTSProvider, TTSResult
from app.tts.duration import probe_duration

API = "https://api.elevenlabs.io/v1"


class ElevenLabsProvider(TTSProvider):
    name = "elevenlabs"
    label = "ElevenLabs"
    model = "eleven_multilingual_v2"
    capabilities = TTSCapabilities(
        exact_duration=True, emotion=True, speed=True, pitch=False,
        ssml=False, nigerian_english_voices=True, native_pidgin_locale=False,
        max_chars=5000,
    )

    # style nudges — ElevenLabs exposes stability/style, not named emotions
    EMOTION_STYLE = {
        "calm": (0.65, 0.15), "confident": (0.45, 0.45), "playful": (0.35, 0.6),
        "mocking": (0.35, 0.65), "defiant": (0.4, 0.6), "excited": (0.25, 0.8),
        "energetic": (0.25, 0.85), "roaring": (0.2, 0.9), "angry": (0.3, 0.75),
    }

    def __init__(self, api_key: str, timeout: float = 60.0):
        self.api_key = api_key
        self.timeout = timeout

    async def generate(
        self, text: str, voice: str, language: str,
        emotion: str | None = None, speed: float = 1.0, pitch: float = 1.0,
    ) -> TTSResult:
        if not self.api_key:
            raise TTSError.not_configured(self.name)
        if len(text) > self.capabilities.max_chars:
            raise TTSError.invalid_text(self.name, f"text exceeds {self.capabilities.max_chars} characters")

        stability, style = self.EMOTION_STYLE.get(emotion or "confident", (0.45, 0.45))
        payload = {
            "text": text,                       # verbatim — Pidgin preserved
            "model_id": self.model,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": 0.8,
                "style": style,
                "use_speaker_boost": True,
                "speed": max(0.7, min(1.2, speed)),
            },
        }
        headers = {"xi-api-key": self.api_key, "accept": "audio/mpeg"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(f"{API}/text-to-speech/{voice}", headers=headers, json=payload)
            except httpx.TimeoutException:
                raise TTSError.timeout(self.name)
            except httpx.HTTPError:
                raise TTSError("TTS_UNAVAILABLE", "elevenlabs: network failure.", True, 503)

        if resp.status_code in (401, 403):
            raise TTSError.auth(self.name)
        if resp.status_code == 429:
            raise TTSError.rate_limit(self.name)
        if resp.status_code == 422:
            raise TTSError.invalid_text(self.name, resp.text[:200])
        if resp.status_code != 200:
            raise TTSError("TTS_FAILED", f"elevenlabs: HTTP {resp.status_code}", True)

        audio = resp.content
        duration = await probe_duration(audio, ".mp3")
        if duration is None:
            raise TTSError("TTS_FAILED", "elevenlabs: could not measure audio duration.", True)
        return TTSResult(audio=audio, mime="audio/mpeg", duration=duration,
                         provider=self.name, voice=voice, meta={"model": self.model})
`,
  },
  {
    path: "app/tts/providers/azure_provider.py",
    language: "python",
    code: `"""Azure AI Speech adapter.

Ships genuine Nigerian English neural voices — en-NG-EzinneNeural
(female) and en-NG-AbeoNeural (male) — plus SSML prosody control,
which makes it the best fit for BRYME's Naija banter. Still no
Pidgin locale: the Pidgin text is spoken verbatim by an en-NG voice.

POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
"""
from __future__ import annotations

import html

import httpx

from app.tts.base import TTSCapabilities, TTSError, TTSProvider, TTSResult
from app.tts.duration import probe_duration

NIGERIAN_VOICES = {
    "male": "en-NG-AbeoNeural",
    "female": "en-NG-EzinneNeural",
}


class AzureSpeechProvider(TTSProvider):
    name = "azure"
    label = "Azure AI Speech"
    model = "neural"
    capabilities = TTSCapabilities(
        exact_duration=True, emotion=True, speed=True, pitch=True,
        ssml=True, nigerian_english_voices=True, native_pidgin_locale=False,
        max_chars=8000,
    )

    def __init__(self, api_key: str, region: str = "westeurope", timeout: float = 60.0):
        self.api_key = api_key
        self.region = region
        self.timeout = timeout

    def _ssml(self, text: str, voice: str, language: str, emotion: str | None, speed: float, pitch: float) -> str:
        rate = f"{int((speed - 1) * 100):+d}%"
        pitch_pct = f"{int((pitch - 1) * 50):+d}%"
        body = html.escape(text)          # escaped for XML, NOT rewritten
        inner = f'<prosody rate="{rate}" pitch="{pitch_pct}">{body}</prosody>'
        if emotion:
            # mstts styles are only valid on voices that advertise them;
            # unsupported styles are ignored by the service, not fatal.
            inner = f'<mstts:express-as style="{html.escape(emotion)}">{inner}</mstts:express-as>'
        return (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/Synthesis" '
            'xmlns:mstts="https://www.w3.org/2001/mstts" '
            f'xml:lang="{language}"><voice name="{voice}">{inner}</voice></speak>'
        )

    async def generate(
        self, text: str, voice: str, language: str,
        emotion: str | None = None, speed: float = 1.0, pitch: float = 1.0,
    ) -> TTSResult:
        if not self.api_key:
            raise TTSError.not_configured(self.name)

        endpoint = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1"
        headers = {
            "Ocp-Apim-Subscription-Key": self.api_key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "bryme-motion-engine",
        }
        ssml = self._ssml(text, voice, language, emotion, speed, pitch)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                resp = await client.post(endpoint, headers=headers, content=ssml.encode("utf-8"))
            except httpx.TimeoutException:
                raise TTSError.timeout(self.name)
            except httpx.HTTPError:
                raise TTSError("TTS_UNAVAILABLE", "azure: network failure.", True, 503)

        if resp.status_code in (401, 403):
            raise TTSError.auth(self.name)
        if resp.status_code == 429:
            raise TTSError.rate_limit(self.name)
        if resp.status_code == 400:
            raise TTSError.invalid_text(self.name, resp.text[:200])
        if resp.status_code != 200:
            raise TTSError("TTS_FAILED", f"azure: HTTP {resp.status_code}", True)

        audio = resp.content
        duration = await probe_duration(audio, ".wav")
        if duration is None:
            raise TTSError("TTS_FAILED", "azure: could not measure audio duration.", True)
        return TTSResult(audio=audio, mime="audio/wav", duration=duration,
                         provider=self.name, voice=voice,
                         meta={"region": self.region, "ssml": "true"})
`,
  },
  {
    path: "app/tts/providers/mock_provider.py",
    language: "python",
    code: `"""Deterministic offline TTS.

Emits a real, playable WAV of exactly the estimated length (silence
with a faint marker tone) so the entire motion pipeline — timeline,
bubbles, FFmpeg mux — can be exercised in CI with zero spend.
"""
from __future__ import annotations

import io
import math
import struct
import wave

from app.tts.base import TTSCapabilities, TTSProvider, TTSResult
from app.tts.duration import estimate_duration

SAMPLE_RATE = 24000


class MockTTSProvider(TTSProvider):
    name = "mock"
    label = "Mock TTS"
    model = "bryme/tone-wav"
    capabilities = TTSCapabilities(
        exact_duration=True, emotion=True, speed=True, pitch=True,
        ssml=False, nigerian_english_voices=False, native_pidgin_locale=False,
    )

    def __init__(self):
        self.api_key = "mock"

    async def generate(
        self, text: str, voice: str, language: str,
        emotion: str | None = None, speed: float = 1.0, pitch: float = 1.0,
    ) -> TTSResult:
        duration = estimate_duration(text, speed, emotion or "confident")
        frames = int(duration * SAMPLE_RATE)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            base = 110 * pitch
            data = bytearray()
            for i in range(frames):
                # very quiet syllable-rate pulse so waveforms are visible
                env = 0.5 + 0.5 * math.sin(2 * math.pi * 4.2 * (i / SAMPLE_RATE))
                sample = int(1200 * env * math.sin(2 * math.pi * base * (i / SAMPLE_RATE)))
                data += struct.pack("<h", sample)
            w.writeframes(bytes(data))
        audio = buf.getvalue()
        return TTSResult(audio=audio, mime="audio/wav", duration=duration,
                         provider=self.name, voice=voice,
                         meta={"synthetic": "true", "chars": str(len(text))})
`,
  },
  {
    path: "app/tts/service.py",
    language: "python",
    code: `"""TTS orchestration: registry, voice bible resolution, caching.

Cost control lives here. A line is only sent to a paid provider when
(text + voice + settings) has never been synthesized before; otherwise
the stored AudioAsset is reused and nothing is billed.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models_motion import AudioAssetModel, DialogueLineModel, VoiceProfileModel
from app.storage.base import ImageStorage
from app.tts.base import TTSError, TTSProvider, voice_cache_key
from app.tts.providers.azure_provider import AzureSpeechProvider
from app.tts.providers.elevenlabs_provider import ElevenLabsProvider
from app.tts.providers.mock_provider import MockTTSProvider

log = logging.getLogger("bryme.tts")


def build_tts_providers(settings: Settings) -> dict[str, TTSProvider]:
    return {
        "mock": MockTTSProvider(),
        "elevenlabs": ElevenLabsProvider(settings.elevenlabs_api_key, settings.provider_timeout_seconds),
        "azure": AzureSpeechProvider(settings.azure_speech_key, settings.azure_speech_region, settings.provider_timeout_seconds),
    }


def resolve_provider(providers: dict[str, TTSProvider], name: str | None, default: str) -> tuple[str, TTSProvider]:
    chosen = name or default
    provider = providers.get(chosen)
    if provider is None:
        raise TTSError("TTS_NOT_CONFIGURED", f"No TTS adapter registered for '{chosen}'.", False, 400)
    if not provider.available:
        raise TTSError.not_configured(chosen)
    return chosen, provider


async def synthesize_line(
    session: AsyncSession,
    storage: ImageStorage,
    providers: dict[str, TTSProvider],
    line: DialogueLineModel,
    provider_name: str | None,
    default_provider: str,
    force: bool = False,
) -> tuple[AudioAssetModel, bool]:
    """Returns (asset, cached). Never re-bills an identical request."""
    profile = await session.get(VoiceProfileModel, line.voice_profile_id)
    if profile is None:
        raise TTSError("VOICE_PROFILE_NOT_FOUND", f"Voice profile '{line.voice_profile_id}' does not exist.", False, 404)

    speed = line.speed_override if line.speed_override is not None else profile.speed
    pitch = line.pitch_override if line.pitch_override is not None else profile.pitch
    emotion = line.emotion or profile.default_emotion

    key = voice_cache_key(line.text, profile.voice_id, profile.language, emotion, speed, pitch)

    if not force:
        existing = await session.execute(select(AudioAssetModel).where(AudioAssetModel.cache_key == key))
        hit = existing.scalar_one_or_none()
        if hit:
            log.info("tts cache hit for line %s (%s)", line.id, key)
            return hit, True

    chosen, provider = resolve_provider(providers, provider_name or profile.provider, default_provider)

    if not provider.capabilities.native_pidgin_locale and "pidgin" in (line.language_label or "").lower():
        log.info(
            "line %s is Pidgin; %s has no Pidgin locale — sending text verbatim to %s",
            line.id, chosen, profile.voice_id,
        )

    result = await provider.generate(
        text=line.text,                # VERBATIM. never translated, never cleaned up
        voice=profile.voice_id,
        language=profile.language,
        emotion=emotion if provider.capabilities.emotion else None,
        speed=speed if provider.capabilities.speed else 1.0,
        pitch=pitch if provider.capabilities.pitch else 1.0,
    )

    ext = "wav" if "wav" in result.mime else "mp3"
    stored = await storage.save(result.audio, ext, result.mime)

    asset = AudioAssetModel(
        dialogue_id=line.id,
        cache_key=key,
        provider=result.provider,
        voice_id=result.voice,
        url=stored.url,
        storage_key=stored.key,
        mime=result.mime,
        duration=result.duration,
        duration_source="measured",
        characters=len(line.text),
        meta=result.meta,
    )
    session.add(asset)
    line.audio_asset_id = asset.id
    await session.commit()
    await session.refresh(asset)
    return asset, False
`,
  },

  /* ============================ MOTION LAYER ============================ */
  {
    path: "app/motion/__init__.py",
    language: "python",
    code: "",
  },
  {
    path: "app/motion/camera.py",
    language: "python",
    code: `"""Camera choreography.

Static artwork must never just sit there — but movement has to stay
subtle enough that the image never softens. Scale is capped at 1.18x
and every move is eased, never linear.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

MAX_SCALE = 1.18

EVENT_CAMERA = {
    "goal": "zoom_in", "celebration": "zoom_in", "save": "focus_character",
    "penalty": "zoom_in", "var": "pan_right", "argument": "shake",
    "kickoff": "zoom_out", "crowd_reaction": "zoom_in", "full_time": "zoom_out",
    "half_time": "slow_drift", "yellow_card": "focus_character",
    "red_card": "focus_character", "miss": "zoom_in", "injury": "slow_drift",
    "substitution": "pan_left", "assist": "pan_right",
}

EVENT_SHAKE = {
    "goal": (0.12, 0.72, 1.0),
    "celebration": (0.10, 0.50, 0.6),
    "argument": (0.20, 1.40, 0.55),
    "save": (0.05, 0.35, 0.4),
    "red_card": (0.00, 0.40, 0.5),
}


@dataclass
class Keyframe:
    t: float
    scale: float
    x: float
    y: float


@dataclass
class CameraTrack:
    move: str
    keyframes: list[Keyframe] = field(default_factory=list)
    shakes: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"move": self.move, "keyframes": [asdict(k) for k in self.keyframes], "shakes": self.shakes}


def camera_move_for(event_type: str | None) -> str:
    return EVENT_CAMERA.get(event_type or "", "slow_drift")


def build_camera(move: str, duration: float, focus: tuple[float, float] | None, event_type: str | None = None) -> CameraTrack:
    """focus is normalized (x, y) or None -> safe centre framing."""
    fx, fy = focus if focus else (0.5, 0.5)
    k: list[Keyframe] = []

    if move == "zoom_in":
        k = [Keyframe(0, 1.02, 0.5, 0.5), Keyframe(duration, 1.17, fx, fy)]
    elif move == "zoom_out":
        k = [Keyframe(0, MAX_SCALE, fx, fy), Keyframe(duration, 1.02, 0.5, 0.5)]
    elif move == "focus_character":
        k = [Keyframe(0, 1.06, 0.5, 0.5), Keyframe(duration * 0.55, 1.15, fx, fy), Keyframe(duration, 1.13, fx, fy)]
    elif move == "pan_left":
        k = [Keyframe(0, 1.10, 0.62, 0.5), Keyframe(duration, 1.10, 0.38, 0.5)]
    elif move == "pan_right":
        k = [Keyframe(0, 1.10, 0.38, 0.5), Keyframe(duration, 1.10, 0.62, 0.5)]
    elif move == "pan_up":
        k = [Keyframe(0, 1.10, 0.5, 0.62), Keyframe(duration, 1.10, 0.5, 0.38)]
    elif move == "pan_down":
        k = [Keyframe(0, 1.10, 0.5, 0.38), Keyframe(duration, 1.10, 0.5, 0.62)]
    elif move == "shake":
        k = [Keyframe(0, 1.08, fx, fy), Keyframe(duration, 1.12, fx, fy)]
    elif move == "focus_center":
        k = [Keyframe(0, 1.05, 0.5, 0.5), Keyframe(duration, 1.05, 0.5, 0.5)]
    else:  # slow_drift
        k = [Keyframe(0, 1.04, 0.46, 0.5), Keyframe(duration, 1.11, 0.54, 0.5)]

    shakes = []
    hit = EVENT_SHAKE.get(event_type or "")
    if hit:
        s, e, i = hit
        shakes.append({"start": s, "end": min(e, duration), "intensity": i})
    if move == "shake" and not shakes:
        shakes.append({"start": 0.2, "end": min(1.4, duration), "intensity": 0.55})

    for kf in k:
        kf.scale = min(kf.scale, MAX_SCALE)
    return CameraTrack(move=move, keyframes=k, shakes=shakes)


def ffmpeg_zoompan(track: CameraTrack, duration: float, fps: int, out_w: int, out_h: int) -> str:
    """Render the camera as an FFmpeg zoompan expression.

    zoompan works per-frame with 'on' (output frame number); we map the
    first and last keyframe into a linear-in-time zoom and centre pan,
    which is visually equivalent to our eased curve at these amplitudes.
    """
    if not track.keyframes:
        return f"zoompan=z=1:d={int(duration * fps)}:s={out_w}x{out_h}:fps={fps}"
    a = track.keyframes[0]
    b = track.keyframes[-1]
    frames = max(1, int(duration * fps))
    z = f"'{a.scale}+({b.scale - a.scale})*on/{frames}'"
    # x/y are top-left of the zoom window, derived from the focal point
    x = f"'iw*({a.x}+({b.x - a.x})*on/{frames})-(iw/zoom/2)'"
    y = f"'ih*({a.y}+({b.y - a.y})*on/{frames})-(ih/zoom/2)'"
    return f"zoompan=z={z}:x={x}:y={y}:d={frames}:s={out_w}x{out_h}:fps={fps}"
`,
  },
  {
    path: "app/motion/bubbles.py",
    language: "python",
    code: `"""Speech-bubble rendering.

Bubbles are rasterized to transparent PNGs with Pillow, then overlaid
by FFmpeg on a time window. Doing the typography in Pillow (rather
than drawtext) gives proper wrapping, tails and per-style skins, and
guarantees the dialogue renders exactly as authored — including
Nigerian Pidgin punctuation and casing.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STYLE_SKIN = {
    "speech":      {"bg": (247, 245, 239, 245), "fg": (18, 20, 15), "stroke": (18, 20, 15), "accent": (108, 180, 238)},
    "shout":       {"bg": (255, 233, 199, 248), "fg": (32, 21, 10), "stroke": (32, 21, 10), "accent": (255, 106, 61)},
    "whisper":     {"bg": (238, 242, 234, 220), "fg": (42, 47, 39), "stroke": (108, 114, 104), "accent": (167, 139, 250)},
    "thought":     {"bg": (239, 243, 250, 240), "fg": (23, 27, 34), "stroke": (59, 66, 80), "accent": (167, 139, 250)},
    "commentator": {"bg": (16, 20, 16, 235), "fg": (242, 246, 238), "stroke": (61, 214, 140), "accent": (61, 214, 140)},
    "narration":   {"bg": (20, 18, 12, 235), "fg": (245, 238, 220), "stroke": (232, 193, 90), "accent": (232, 193, 90)},
    "crowd":       {"bg": (12, 16, 12, 210), "fg": (234, 246, 232), "stroke": (108, 180, 238), "accent": (108, 180, 238)},
}

ANIM_BY_STYLE = {
    "speech": "pop_in", "shout": "shake_in", "whisper": "fade_in",
    "thought": "fade_in", "commentator": "slide_in", "narration": "slide_in",
    "crowd": "bounce_in",
}


@dataclass
class RenderedBubble:
    path: str
    width: int
    height: int
    x: int
    y: int


def _font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = f"{cur} {w}".strip()
        if draw.textlength(test, font=font) > max_w and cur:
            lines.append(cur)
            cur = w
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines or [""]


def render_bubble(
    text: str,
    speaker: str,
    style: str,
    out_dir: Path,
    out_w: int,
    out_h: int,
    anchor: tuple[float, float],
    safe: dict,
    filename: str,
) -> RenderedBubble:
    skin = STYLE_SKIN.get(style, STYLE_SKIN["speech"])
    scale_ref = out_w / 1920
    size = int((21 if style in ("narration", "commentator") else 24) * 2 * scale_ref)
    font = _font(size)
    label_font = _font(max(10, int(size * 0.5)))

    probe = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(probe)
    max_text_w = int(out_w * (0.72 if style in ("narration", "crowd", "commentator") else 0.42))
    lines = wrap(d, text, font, max_text_w)

    line_h = int(size * 1.32)
    pad_x, pad_y = int(size * 0.86), int(size * 0.66)
    text_w = int(max(d.textlength(l, font=font) for l in lines))
    box_w = text_w + pad_x * 2
    box_h = line_h * len(lines) + pad_y * 2
    tail_h = int(20 * scale_ref) if style in ("speech", "shout", "whisper") else 0

    img = Image.new("RGBA", (box_w + 8, box_h + tail_h + 8), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    radius = int((6 if style in ("narration", "commentator") else 18) * 2 * scale_ref)
    dr.rounded_rectangle([0, 0, box_w, box_h], radius=radius,
                         fill=skin["bg"], outline=skin["stroke"], width=max(2, int(3 * scale_ref)))

    if style in ("narration", "commentator"):
        dr.rectangle([0, 0, int(6 * scale_ref), box_h], fill=skin["accent"])

    if tail_h:
        tx = int(box_w * (0.68 if anchor[0] > 0.5 else 0.32))
        tip = tx + (int(22 * scale_ref) if anchor[0] > 0.5 else -int(22 * scale_ref))
        dr.polygon([(tx - int(11 * scale_ref), box_h - 2), (tx + int(9 * scale_ref), box_h - 2), (tip, box_h + tail_h)],
                   fill=skin["bg"], outline=skin["stroke"])

    if speaker and style in ("speech", "shout", "commentator"):
        label = speaker.upper()
        lw = int(dr.textlength(label, font=label_font)) + int(14 * scale_ref)
        dr.rounded_rectangle([pad_x // 2, -int(9 * scale_ref), pad_x // 2 + lw, int(11 * scale_ref)],
                             radius=int(5 * scale_ref), fill=skin["accent"])
        dr.text((pad_x // 2 + int(7 * scale_ref), -int(8 * scale_ref)), label, font=label_font, fill=(11, 14, 12))

    for i, ln in enumerate(lines):
        dr.text((pad_x, pad_y + i * line_h), ln, font=font, fill=skin["fg"])

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename
    img.save(path)

    # placement, clamped into the platform safe area
    cx = anchor[0] * out_w
    cy = anchor[1] * out_h
    min_x = out_w * safe["left"] + box_w / 2
    max_x = out_w * (1 - safe["right"]) - box_w / 2
    min_y = out_h * safe["top"] + box_h / 2
    max_y = out_h * (1 - safe["bottom"]) - box_h / 2
    cx = max(min_x, min(max_x, cx))
    cy = max(min_y, min(max_y, cy))

    return RenderedBubble(str(path), img.width, img.height, int(cx - box_w / 2), int(cy - box_h / 2))


def place_bubble(index: int, total: int, safe: dict, focus: tuple[float, float] | None, style: str) -> tuple[float, float]:
    min_x, max_x = safe["left"] + 0.06, 1 - safe["right"] - 0.06
    min_y, max_y = safe["top"] + 0.05, 1 - safe["bottom"] - 0.05

    if style in ("narration", "commentator"):
        return (min(max(0.5, min_x), max_x), min(max(min_y + 0.02, min_y), max_y))
    if style == "crowd":
        return (min(max(0.5, min_x), max_x), max(min(max_y - 0.02, max_y), min_y))

    lane = 0.5 if total <= 1 else (0.3 if index % 2 == 0 else 0.7)
    x = min(max(lane, min_x), max_x)
    row = 0.26 if total <= 2 else 0.22 + (index % 3) * 0.13
    y = min(max(row, min_y), max_y)
    if focus and abs(focus[0] - x) < 0.18:
        x = min(max(min_x + 0.1 if focus[0] > 0.5 else max_x - 0.1, min_x), max_x)
    return (x, y)
`,
  },
  {
    path: "app/motion/sound_effects.py",
    language: "python",
    code: `"""Sound-effect library.

Every cue resolves to a locally bundled, licence-clean asset (CC0 or
generated). Nothing here samples broadcast audio, commentary or
copyrighted music. Missing files degrade gracefully: the cue is
skipped and a warning is attached to the scene.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

SFX_DIR = Path("assets/sfx")


@dataclass(frozen=True)
class Sfx:
    id: str
    filename: str
    gain: float
    licence: str


LIBRARY: dict[str, Sfx] = {
    "crowd_ambience":   Sfx("crowd_ambience", "crowd_ambience.wav", 0.10, "CC0"),
    "crowd_roar":       Sfx("crowd_roar", "crowd_roar.wav", 0.34, "CC0"),
    "crowd_gasp":       Sfx("crowd_gasp", "crowd_gasp.wav", 0.22, "CC0"),
    "boo":              Sfx("boo", "boo.wav", 0.24, "CC0"),
    "cheer":            Sfx("cheer", "cheer.wav", 0.28, "CC0"),
    "whistle":          Sfx("whistle", "whistle.wav", 0.30, "CC0"),
    "goal_impact":      Sfx("goal_impact", "goal_impact.wav", 0.42, "CC0"),
    "kick":             Sfx("kick", "kick.wav", 0.30, "CC0"),
    "net_ripple":       Sfx("net_ripple", "net_ripple.wav", 0.18, "CC0"),
    "laugh":            Sfx("laugh", "laugh.wav", 0.20, "CC0"),
    "shock_sting":      Sfx("shock_sting", "shock_sting.wav", 0.26, "CC0"),
    "camera_hit":       Sfx("camera_hit", "camera_hit.wav", 0.22, "CC0"),
    "transition_swell": Sfx("transition_swell", "transition_swell.wav", 0.20, "CC0"),
}

EVENT_SFX: dict[str, list[tuple[str, float]]] = {
    "goal": [("kick", 0.02), ("goal_impact", 0.14), ("net_ripple", 0.30), ("crowd_roar", 0.18)],
    "celebration": [("crowd_roar", 0.05), ("cheer", 0.60)],
    "save": [("shock_sting", 0.02), ("crowd_gasp", 0.06)],
    "penalty": [("whistle", 0.05), ("crowd_gasp", 0.50)],
    "var": [("camera_hit", 0.05), ("boo", 0.35)],
    "argument": [("boo", 0.20)],
    "kickoff": [("whistle", 0.25)],
    "half_time": [("whistle", 0.10)],
    "full_time": [("whistle", 0.10), ("crowd_roar", 0.40)],
    "crowd_reaction": [("cheer", 0.05), ("crowd_roar", 0.25)],
    "yellow_card": [("camera_hit", 0.05), ("boo", 0.30)],
    "red_card": [("shock_sting", 0.05), ("boo", 0.40)],
    "miss": [("crowd_gasp", 0.10)],
    "injury": [("crowd_gasp", 0.15)],
}


def cues_for_event(event_type: str | None) -> list[tuple[str, float]]:
    return EVENT_SFX.get(event_type or "", [])


def resolve(sfx_id: str) -> tuple[Sfx, Path] | None:
    spec = LIBRARY.get(sfx_id)
    if not spec:
        return None
    path = SFX_DIR / spec.filename
    return (spec, path) if path.exists() else None
`,
  },
  {
    path: "app/motion/transitions.py",
    language: "python",
    code: `"""Scene transitions, expressed as FFmpeg xfade transitions."""
from __future__ import annotations

EVENT_TRANSITION = {
    "goal": "flash", "celebration": "whip_pan", "save": "whip_pan",
    "var": "dip_to_black", "argument": "whip_pan", "kickoff": "crossfade",
    "full_time": "dip_to_black", "crowd_reaction": "crossfade",
}

# our vocabulary -> xfade's
XFADE = {
    "cut": None,
    "crossfade": "fade",
    "dip_to_black": "fadeblack",
    "flash": "fadewhite",
    "whip_pan": "slideleft",
}

DEFAULT_DURATION = 0.5


def transition_for(event_type: str | None) -> str:
    return EVENT_TRANSITION.get(event_type or "", "crossfade")


def xfade_name(kind: str) -> str | None:
    return XFADE.get(kind, "fade")
`,
  },
  {
    path: "app/motion/timeline.py",
    language: "python",
    code: `"""Automatic timeline construction.

Takes panels + dialogue + *measured* audio durations and produces a
fully choreographed scene. The user never enters a timecode.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.motion import sound_effects, transitions
from app.motion.bubbles import ANIM_BY_STYLE, place_bubble
from app.motion.camera import build_camera, camera_move_for

LEAD_IN = 0.45
LINE_GAP = 0.24
HOLD_AFTER = 0.26
TAIL = 0.70
MIN_SCENE = 3.0

ASPECTS = {
    "16:9": {"w": 1920, "h": 1080, "safe": {"top": 0.06, "bottom": 0.08, "left": 0.05, "right": 0.05}},
    "9:16": {"w": 1080, "h": 1920, "safe": {"top": 0.12, "bottom": 0.22, "left": 0.08, "right": 0.16}},
    "1:1":  {"w": 1080, "h": 1080, "safe": {"top": 0.08, "bottom": 0.12, "left": 0.07, "right": 0.07}},
}


@dataclass
class SceneBuild:
    panel_id: str
    panel_number: int
    title: str
    image_url: str | None
    event_type: str | None
    duration: float
    offset: float
    elements: list[dict] = field(default_factory=list)
    transition_out: str = "crossfade"
    focus_hint: tuple[float, float] | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "scene_id": self.panel_id,
            "panel_number": self.panel_number,
            "title": self.title,
            "image_url": self.image_url,
            "event_type": self.event_type,
            "duration": round(self.duration, 3),
            "offset": round(self.offset, 3),
            "transition_out": self.transition_out,
            "focus_hint": list(self.focus_hint) if self.focus_hint else None,
            "warnings": self.warnings,
            "elements": self.elements,
        }


def build_scene(
    *,
    panel,
    lines: list,
    durations: dict[str, float],
    aspect: str = "16:9",
    sfx_enabled: bool = True,
    ambience_enabled: bool = True,
    focus_hint: tuple[float, float] | None = None,
) -> SceneBuild:
    spec = ASPECTS[aspect]
    safe = spec["safe"]
    warnings: list[str] = []
    if focus_hint is None:
        warnings.append("No focal metadata — camera falls back to a safe centre framing.")
    if not panel.image_url:
        warnings.append("Panel has no rendered artwork; generate it in the image engine first.")

    elements: list[dict] = []
    ordered = sorted(lines, key=lambda l: l.order)

    cursor = LEAD_IN
    for i, line in enumerate(ordered):
        dur = durations.get(line.id, 1.4)
        start = cursor
        audio_end = start + dur
        bubble_end = audio_end + HOLD_AFTER
        anchor = place_bubble(i, len(ordered), safe, focus_hint, line.bubble_style)

        elements.append({
            "id": f"{line.id}-bubble",
            "type": "speech_bubble",
            "start": round(max(0.0, start - 0.12), 3),
            "end": round(bubble_end, 3),
            "speaker": line.speaker_label,
            "dialogue_id": line.id,
            "text": line.text,                       # verbatim
            "bubble_style": line.bubble_style,
            "anim_in": ANIM_BY_STYLE.get(line.bubble_style, "pop_in"),
            "anim_out": "pop_out" if line.bubble_style == "shout" else "fade_out",
            "anchor": list(anchor),
        })
        elements.append({
            "id": f"{line.id}-audio",
            "type": "audio",
            "start": round(start, 3),
            "end": round(audio_end, 3),
            "dialogue_id": line.id,
            "speaker": line.speaker_label,
            "gain": 1.0,
        })
        cursor = bubble_end + LINE_GAP

    duration = round(max(MIN_SCENE, cursor + TAIL), 3)

    elements.insert(0, {
        "id": f"{panel.id}-image", "type": "image",
        "start": 0.0, "end": duration, "source": panel.image_url,
    })

    move = camera_move_for(panel.event.get("type") if panel.event else None)
    cam = build_camera(move, duration, focus_hint, panel.event.get("type") if panel.event else None)
    elements.append({
        "id": f"{panel.id}-camera", "type": "camera",
        "start": 0.0, "end": duration, "camera": cam.to_dict(),
    })

    if sfx_enabled:
        for sfx_id, at in sound_effects.cues_for_event(panel.event.get("type") if panel.event else None):
            elements.append({
                "id": f"{panel.id}-sfx-{sfx_id}-{at}", "type": "sfx",
                "start": at, "end": round(min(duration, at + 2.4), 3),
                "sfx": sfx_id, "gain": 1.0,
            })
    if ambience_enabled:
        elements.append({
            "id": f"{panel.id}-ambience", "type": "sfx",
            "start": 0.0, "end": duration, "sfx": "crowd_ambience", "gain": 1.0,
        })

    kind = transitions.transition_for(panel.event.get("type") if panel.event else None)
    elements.append({
        "id": f"{panel.id}-transition", "type": "transition",
        "start": round(max(0.0, duration - transitions.DEFAULT_DURATION), 3),
        "end": duration, "transition": kind,
    })

    return SceneBuild(
        panel_id=panel.id, panel_number=panel.number, title=panel.title,
        image_url=panel.image_url, event_type=(panel.event or {}).get("type"),
        duration=duration, offset=0.0, elements=elements,
        transition_out=kind, focus_hint=focus_hint, warnings=warnings,
    )


def sequence(scenes: list[SceneBuild], fps: int = 30) -> dict:
    offset = 0.0
    out = []
    for s in scenes:
        s.offset = offset
        offset += s.duration
        out.append(s.to_dict())
    return {"scenes": out, "duration": round(offset, 3), "fps": fps, "version": 1}
`,
  },
  {
    path: "app/motion/renderer.py",
    language: "python",
    code: `"""FFmpeg video renderer.

Timeline -> MP4. One filter graph per scene (camera + bubble overlays),
concatenated with xfade transitions, then mixed against the voice and
SFX beds. Source artwork is never modified: every image is read
read-only and all work happens in a scratch directory.

Progress is parsed live from ffmpeg's -progress stream so the API can
report a real percentage instead of a spinner.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable

from app.motion import sound_effects, transitions
from app.motion.bubbles import render_bubble
from app.motion.camera import CameraTrack, Keyframe, ffmpeg_zoompan
from app.motion.timeline import ASPECTS

log = logging.getLogger("bryme.renderer")

ProgressFn = Callable[[float, int], Awaitable[None]]


class RenderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class RenderResult:
    path: Path
    duration: float
    size_bytes: int
    mime: str


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _track_from_dict(d: dict) -> CameraTrack:
    return CameraTrack(
        move=d.get("move", "slow_drift"),
        keyframes=[Keyframe(**k) for k in d.get("keyframes", [])],
        shakes=d.get("shakes", []),
    )


class MotionRenderer:
    def __init__(self, work_root: Path, fps: int = 30):
        self.work_root = work_root
        self.fps = fps

    async def render(
        self,
        timeline: dict,
        aspect: str,
        audio_index: dict[str, Path],     # dialogue_id -> audio file
        out_path: Path,
        audio_settings: dict,
        music_path: Path | None = None,
        on_progress: ProgressFn | None = None,
    ) -> RenderResult:
        if not ffmpeg_available():
            raise RenderError("FFMPEG_MISSING", "ffmpeg/ffprobe not found on PATH.", retryable=False)

        spec = ASPECTS[aspect]
        W, H = spec["w"], spec["h"]
        scenes = timeline["scenes"]
        if not scenes:
            raise RenderError("EMPTY_TIMELINE", "Timeline contains no scenes.", retryable=False)

        work = self.work_root / out_path.stem
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True, exist_ok=True)

        # ---------- pass 1: one silent clip per scene ----------
        clips: list[Path] = []
        for idx, scene in enumerate(scenes):
            clip = work / f"scene_{idx:03d}.mp4"
            await self._render_scene(scene, spec, work, clip, idx)
            clips.append(clip)
            if on_progress:
                await on_progress((idx + 1) / len(scenes) * 70.0, scene.get("panel_number", idx + 1))

        # ---------- pass 2: stitch with transitions ----------
        stitched = work / "video.mp4"
        await self._concat(clips, scenes, stitched)
        if on_progress:
            await on_progress(80.0, len(scenes))

        # ---------- pass 3: audio bed + mux ----------
        await self._mux(stitched, timeline, audio_index, audio_settings, music_path, out_path, on_progress)

        size = out_path.stat().st_size
        return RenderResult(path=out_path, duration=timeline["duration"], size_bytes=size, mime="video/mp4")

    # ------------------------------------------------------------------

    async def _render_scene(self, scene: dict, spec: dict, work: Path, out: Path, idx: int) -> None:
        W, H, safe = spec["w"], spec["h"], spec["safe"]
        duration = float(scene["duration"])
        image = scene.get("image_url")
        if not image:
            raise RenderError("MISSING_ARTWORK", f"Scene {scene['scene_id']} has no image.", retryable=False)
        image_path = self._local_path(image)

        cam_el = next((e for e in scene["elements"] if e["type"] == "camera"), None)
        cam = _track_from_dict(cam_el["camera"]) if cam_el else None

        # crop to the output aspect first (never stretch), then zoompan
        chain = [
            f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase",
            f"crop={W * 2}:{H * 2}",
        ]
        chain.append(ffmpeg_zoompan(cam, duration, self.fps, W, H) if cam
                     else f"scale={W}:{H},fps={self.fps}")
        chain.append("format=yuv420p")

        inputs = ["-loop", "1", "-t", f"{duration}", "-i", str(image_path)]
        filter_parts = [f"[0:v]{','.join(chain)}[base]"]
        last = "base"

        # bubbles as timed overlays with a short fade in/out
        bubble_inputs = 0
        for el in [e for e in scene["elements"] if e["type"] == "speech_bubble"]:
            rb = render_bubble(
                text=el["text"], speaker=el.get("speaker", ""), style=el.get("bubble_style", "speech"),
                out_dir=work / "bubbles", out_w=W, out_h=H,
                anchor=tuple(el.get("anchor", [0.5, 0.25])), safe=safe,
                filename=f"{scene['scene_id']}_{el['id']}.png",
            )
            bubble_inputs += 1
            i = bubble_inputs
            inputs += ["-i", rb.path]
            start, end = float(el["start"]), float(el["end"])
            fade = 0.22
            filter_parts.append(
                f"[{i}:v]format=rgba,"
                f"fade=t=in:st={start:.3f}:d={fade}:alpha=1,"
                f"fade=t=out:st={max(start, end - fade):.3f}:d={fade}:alpha=1[bub{i}]"
            )
            filter_parts.append(
                f"[{last}][bub{i}]overlay=x={rb.x}:y={rb.y}:"
                f"enable='between(t,{start:.3f},{end:.3f})'[ov{i}]"
            )
            last = f"ov{i}"

        graph = ";".join(filter_parts)
        cmd = [
            "ffmpeg", "-y", *inputs,
            "-filter_complex", graph,
            "-map", f"[{last}]",
            "-t", f"{duration}",
            "-r", str(self.fps),
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(out),
        ]
        await self._run(cmd, f"scene {idx}")

    async def _concat(self, clips: list[Path], scenes: list[dict], out: Path) -> None:
        if len(clips) == 1:
            shutil.copy(clips[0], out)
            return

        inputs: list[str] = []
        for c in clips:
            inputs += ["-i", str(c)]

        parts: list[str] = []
        last = "0:v"
        offset = 0.0
        for i in range(1, len(clips)):
            kind = scenes[i - 1].get("transition_out", "crossfade")
            xf = transitions.xfade_name(kind)
            d = transitions.DEFAULT_DURATION
            offset += float(scenes[i - 1]["duration"]) - d
            if xf is None:
                parts.append(f"[{last}][{i}:v]concat=n=2:v=1:a=0[v{i}]")
            else:
                parts.append(
                    f"[{last}][{i}:v]xfade=transition={xf}:duration={d}:offset={max(0.0, offset):.3f}[v{i}]"
                )
            last = f"v{i}"

        cmd = ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(parts),
               "-map", f"[{last}]", "-c:v", "libx264", "-preset", "medium",
               "-crf", "20", "-pix_fmt", "yuv420p", str(out)]
        await self._run(cmd, "concat")

    async def _mux(
        self,
        video: Path,
        timeline: dict,
        audio_index: dict[str, Path],
        settings: dict,
        music: Path | None,
        out: Path,
        on_progress: ProgressFn | None,
    ) -> None:
        inputs = ["-i", str(video)]
        parts: list[str] = []
        labels: list[str] = []
        n = 1

        voice_gain = float(settings.get("voice_gain", 1.0))
        sfx_gain = float(settings.get("sfx_gain", 0.85))

        for scene in timeline["scenes"]:
            base = float(scene["offset"])
            for el in scene["elements"]:
                if el["type"] == "audio":
                    path = audio_index.get(el.get("dialogue_id", ""))
                    if not path or not Path(path).exists():
                        continue
                    delay = int((base + float(el["start"])) * 1000)
                    inputs += ["-i", str(path)]
                    parts.append(
                        f"[{n}:a]adelay={delay}|{delay},volume={voice_gain * float(el.get('gain', 1.0)):.3f}[a{n}]"
                    )
                    labels.append(f"[a{n}]")
                    n += 1
                elif el["type"] == "sfx":
                    resolved = sound_effects.resolve(el.get("sfx", ""))
                    if not resolved:
                        continue
                    spec, path = resolved
                    delay = int((base + float(el["start"])) * 1000)
                    inputs += ["-i", str(path)]
                    # sidechain-free ducking: SFX sit under the voice bed
                    parts.append(
                        f"[{n}:a]adelay={delay}|{delay},volume={spec.gain * sfx_gain:.3f}[a{n}]"
                    )
                    labels.append(f"[a{n}]")
                    n += 1

        if music and Path(music).exists() and settings.get("music_enabled"):
            mg = float(settings.get("music_gain", 0.25))
            dur = float(timeline["duration"])
            inputs += ["-i", str(music)]
            parts.append(
                f"[{n}:a]volume={mg:.3f},afade=t=in:st=0:d=1.5,"
                f"afade=t=out:st={max(0.0, dur - 2.0):.3f}:d=2.0[a{n}]"
            )
            labels.append(f"[a{n}]")
            n += 1

        if not labels:
            # no audio at all — still produce a valid file
            shutil.copy(video, out)
            return

        parts.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,"
                     f"alimiter=limit=0.95,aresample=48000[aout]")

        cmd = [
            "ffmpeg", "-y", *inputs,
            "-filter_complex", ";".join(parts),
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats",
            str(out),
        ]
        await self._run(cmd, "mux", total=float(timeline["duration"]), on_progress=on_progress)

    # ------------------------------------------------------------------

    async def _run(self, cmd: list[str], label: str, total: float | None = None, on_progress: ProgressFn | None = None) -> None:
        log.debug("ffmpeg %s: %s", label, " ".join(cmd[:12]))
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        if total and on_progress and proc.stdout:
            pattern = re.compile(rb"out_time_ms=(\\d+)")
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                match = pattern.search(line)
                if match:
                    secs = int(match.group(1)) / 1_000_000
                    await on_progress(80.0 + min(19.0, (secs / total) * 19.0), 0)
        _, err = await proc.communicate()
        if proc.returncode != 0:
            tail = (err or b"").decode("utf-8", "ignore")[-600:]
            raise RenderError("FFMPEG_FAILED", f"{label} failed: {tail}")

    @staticmethod
    def _local_path(url: str) -> Path:
        """Map a stored image URL back to its file on disk."""
        from app.config import get_settings

        settings = get_settings()
        name = url.rstrip("/").split("/")[-1]
        return Path(settings.storage_dir) / name
`,
  },
  {
    path: "app/motion/motion_service.py",
    language: "python",
    code: `"""Motion-comic orchestration.

auto_build() is the one-call path from a finished comic to a rendered
timeline: import panels -> resolve voices -> synthesize -> measure ->
timeline -> bubbles -> camera -> transitions -> sfx -> persist.

Everything is incremental. Changing a bubble does not re-cut audio;
changing a voice does not re-render artwork.
"""
from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import PanelModel
from app.models_motion import (
    AudioAssetModel, DialogueLineModel, MotionProjectModel, RenderJobModel, TimelineEventModel,
)
from app.motion.camera import build_camera
from app.motion.renderer import MotionRenderer, RenderError
from app.motion.timeline import build_scene, sequence
from app.storage.base import ImageStorage
from app.tts.base import TTSProvider
from app.tts.service import synthesize_line

log = logging.getLogger("bryme.motion")
settings = get_settings()

# Reliable focal metadata only — authored, never guessed from pixels.
FOCUS_HINTS: dict[str, tuple[float, float]] = {
    "panel-01": (0.50, 0.46),
    "panel-07": (0.44, 0.54),
    "panel-12": (0.52, 0.44),
    "panel-20": (0.43, 0.42),
    "panel-21": (0.50, 0.44),
}


async def _panels(session: AsyncSession, comic_project_id: str) -> list[PanelModel]:
    result = await session.execute(
        select(PanelModel).where(PanelModel.project_id == comic_project_id).order_by(PanelModel.number)
    )
    return list(result.scalars().all())


async def _lines(session: AsyncSession, panel_id: str) -> list[DialogueLineModel]:
    result = await session.execute(
        select(DialogueLineModel).where(DialogueLineModel.panel_id == panel_id).order_by(DialogueLineModel.order)
    )
    return list(result.scalars().all())


async def auto_build(
    session: AsyncSession,
    storage: ImageStorage,
    tts_providers: dict[str, TTSProvider],
    motion_project: MotionProjectModel,
    provider_name: str | None = None,
    force_voices: bool = False,
) -> dict:
    panels = await _panels(session, motion_project.comic_project_id)
    if not panels:
        raise ValueError("Comic project has no panels.")

    durations: dict[str, float] = {}
    synthesized = cached = 0

    for panel in panels:
        for line in await _lines(session, panel.id):
            asset, was_cached = await synthesize_line(
                session, storage, tts_providers, line,
                provider_name, settings.default_tts_provider, force=force_voices,
            )
            durations[line.id] = asset.duration
            cached += int(was_cached)
            synthesized += int(not was_cached)

    scenes = []
    for panel in panels:
        lines = await _lines(session, panel.id)
        scenes.append(build_scene(
            panel=panel, lines=lines, durations=durations,
            aspect=motion_project.aspect_ratio,
            sfx_enabled=motion_project.sfx_enabled,
            ambience_enabled=motion_project.ambience_enabled,
            focus_hint=FOCUS_HINTS.get(panel.id),
        ))

    timeline = sequence(scenes, motion_project.fps)
    motion_project.timeline = timeline
    motion_project.total_duration = timeline["duration"]
    motion_project.render_status = "draft"

    # denormalized rows so the timeline is queryable/editable per element
    await session.execute(TimelineEventModel.__table__.delete().where(
        TimelineEventModel.motion_project_id == motion_project.id
    ))
    for scene in timeline["scenes"]:
        for el in scene["elements"]:
            session.add(TimelineEventModel(
                motion_project_id=motion_project.id,
                scene_id=scene["scene_id"],
                element_id=el["id"],
                type=el["type"],
                start=el["start"],
                end=el["end"],
                payload=el,
            ))
    await session.commit()

    log.info("auto-build complete: %s scenes, %.1fs, %s synthesized / %s cached",
             len(scenes), timeline["duration"], synthesized, cached)

    return {
        "project_id": motion_project.id,
        "status": "ready",
        "total_panels": len(panels),
        "total_duration": timeline["duration"],
        "voices_synthesized": synthesized,
        "voices_from_cache": cached,
        "warnings": [w for s in timeline["scenes"] for w in s["warnings"]],
    }


async def update_camera(session: AsyncSession, project: MotionProjectModel, scene_id: str, move: str) -> dict:
    """Camera only. No artwork, no audio, no billing."""
    timeline = project.timeline or {}
    for scene in timeline.get("scenes", []):
        if scene["scene_id"] != scene_id:
            continue
        focus = tuple(scene["focus_hint"]) if scene.get("focus_hint") else None
        track = build_camera(move, scene["duration"], focus, scene.get("event_type"))
        for el in scene["elements"]:
            if el["type"] == "camera":
                el["camera"] = track.to_dict()
    project.timeline = timeline
    project.render_status = "draft"
    await session.commit()
    return timeline


async def update_bubble(session: AsyncSession, project: MotionProjectModel, dialogue_id: str, patch: dict) -> dict:
    """Bubble only. Text edits mark the audio stale rather than silently
    re-billing a synthesis the caller did not ask for."""
    timeline = project.timeline or {}
    stale = False
    for scene in timeline.get("scenes", []):
        for el in scene["elements"]:
            if el["type"] != "speech_bubble" or el.get("dialogue_id") != dialogue_id:
                continue
            if "text" in patch and patch["text"] != el["text"]:
                el["text"] = patch["text"]
                stale = True
            if "bubble_style" in patch:
                el["bubble_style"] = patch["bubble_style"]
            if "anchor" in patch:
                el["anchor"] = patch["anchor"]
    project.timeline = timeline
    project.render_status = "draft"
    line = await session.get(DialogueLineModel, dialogue_id)
    if line and "text" in patch:
        line.text = patch["text"]
        line.audio_stale = stale
    await session.commit()
    return {"timeline": timeline, "audio_stale": stale}


async def run_render(
    session: AsyncSession,
    storage: ImageStorage,
    project: MotionProjectModel,
    job: RenderJobModel,
) -> None:
    """Executed by the async worker — never inside a request."""
    renderer = MotionRenderer(Path(settings.render_work_dir), fps=project.fps)
    job.status = "rendering"
    await session.commit()

    audio_index: dict[str, Path] = {}
    result = await session.execute(select(AudioAssetModel))
    for asset in result.scalars().all():
        if asset.storage_key:
            audio_index[asset.dialogue_id] = Path(settings.storage_dir) / asset.storage_key

    async def progress(pct: float, panel: int) -> None:
        job.progress = int(min(99, pct))
        if panel:
            job.current_panel = panel
        await session.commit()

    out_dir = Path(settings.render_output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{project.id}_{job.id}.mp4"

    try:
        rendered = await renderer.render(
            timeline=project.timeline,
            aspect=project.aspect_ratio,
            audio_index=audio_index,
            out_path=out_path,
            audio_settings=project.audio_settings,
            music_path=Path(project.music_track) if project.music_track else None,
            on_progress=progress,
        )
        stored = await storage.save(out_path.read_bytes(), "mp4", "video/mp4")
        job.status = "completed"
        job.progress = 100
        job.video_url = stored.url
        job.size_bytes = rendered.size_bytes
        project.render_status = "completed"
        project.video_url = stored.url
    except RenderError as exc:
        job.status = "failed"
        job.error = {"code": exc.code, "message": exc.message, "retryable": exc.retryable}
        project.render_status = "failed"
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = {"code": "RENDER_FAILED", "message": str(exc)[:400], "retryable": False}
        project.render_status = "failed"
    finally:
        await session.commit()
`,
  },

  /* ========================== MODELS / API / TESTS ========================== */
  {
    path: "app/models_motion.py",
    language: "python",
    code: `"""Motion-layer tables.

Related to the existing projects / panels / characters without
altering them: motion is additive.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VoiceProfileModel(Base):
    """The Voice Bible — an extension of the Character Bible."""
    __tablename__ = "voice_profiles"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("vp"))
    character_id: Mapped[str | None] = mapped_column(ForeignKey("characters.id"), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(140), default="")
    provider: Mapped[str] = mapped_column(String(32), default="azure")
    voice_id: Mapped[str] = mapped_column(String(120), default="")
    language: Mapped[str] = mapped_column(String(16), default="en-NG")
    language_label: Mapped[str] = mapped_column(String(60), default="Nigerian Pidgin")
    accent: Mapped[str] = mapped_column(String(60), default="Nigerian")
    gender: Mapped[str] = mapped_column(String(16), default="male")
    age_style: Mapped[str] = mapped_column(String(40), default="adult")
    default_emotion: Mapped[str] = mapped_column(String(40), default="confident")
    speed: Mapped[float] = mapped_column(Float, default=1.0)
    pitch: Mapped[float] = mapped_column(Float, default=1.0)
    volume: Mapped[float] = mapped_column(Float, default=1.0)
    bubble_style: Mapped[str] = mapped_column(String(24), default="speech")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)


class DialogueLineModel(Base):
    __tablename__ = "dialogue_lines"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("dlg"))
    panel_id: Mapped[str] = mapped_column(ForeignKey("panels.id"), index=True)
    order: Mapped[int] = mapped_column(Integer, default=1)
    speaker_label: Mapped[str] = mapped_column(String(120), default="")
    character_id: Mapped[str | None] = mapped_column(ForeignKey("characters.id"), nullable=True)
    voice_profile_id: Mapped[str] = mapped_column(ForeignKey("voice_profiles.id"))
    # PRESERVED VERBATIM. The engine never translates or rewrites this.
    text: Mapped[str] = mapped_column(Text)
    language_label: Mapped[str] = mapped_column(String(60), default="Nigerian Pidgin")
    kind: Mapped[str] = mapped_column(String(24), default="speech")
    bubble_style: Mapped[str] = mapped_column(String(24), default="speech")
    emotion: Mapped[str] = mapped_column(String(40), default="confident")
    speed_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    pitch_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    audio_asset_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    audio_stale: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class AudioAssetModel(Base):
    __tablename__ = "audio_assets"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("aud"))
    dialogue_id: Mapped[str] = mapped_column(ForeignKey("dialogue_lines.id"), index=True)
    cache_key: Mapped[str] = mapped_column(String(64), index=True, unique=True)
    provider: Mapped[str] = mapped_column(String(32))
    voice_id: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str] = mapped_column(String(180), default="")
    mime: Mapped[str] = mapped_column(String(40), default="audio/wav")
    duration: Mapped[float] = mapped_column(Float)
    duration_source: Mapped[str] = mapped_column(String(16), default="measured")
    characters: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class MotionProjectModel(Base):
    __tablename__ = "motion_comic_projects"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("mc"))
    comic_project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    aspect_ratio: Mapped[str] = mapped_column(String(8), default="16:9")
    fps: Mapped[int] = mapped_column(Integer, default=30)
    timeline: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_duration: Mapped[float] = mapped_column(Float, default=0.0)
    audio_settings: Mapped[dict] = mapped_column(JSON, default=lambda: {
        "voice_gain": 1.0, "sfx_gain": 0.85, "music_gain": 0.25,
        "music_enabled": False, "duck_sfx_under_voice": True,
    })
    music_track: Mapped[str | None] = mapped_column(Text, nullable=True)
    sfx_enabled: Mapped[bool] = mapped_column(default=True)
    ambience_enabled: Mapped[bool] = mapped_column(default=True)
    render_status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class TimelineEventModel(Base):
    """Denormalized elements so the frontend can PATCH one block."""
    __tablename__ = "timeline_events"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("tev"))
    motion_project_id: Mapped[str] = mapped_column(ForeignKey("motion_comic_projects.id"), index=True)
    scene_id: Mapped[str] = mapped_column(String(48), index=True)
    element_id: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(24), index=True)
    start: Mapped[float] = mapped_column(Float)
    end: Mapped[float] = mapped_column(Float)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class RenderJobModel(Base):
    __tablename__ = "render_jobs"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("rnd"))
    motion_project_id: Mapped[str] = mapped_column(ForeignKey("motion_comic_projects.id"), index=True)
    format: Mapped[str] = mapped_column(String(12), default="mp4")
    aspect_ratio: Mapped[str] = mapped_column(String(8), default="16:9")
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    current_panel: Mapped[int] = mapped_column(Integer, default=0)
    total_panels: Mapped[int] = mapped_column(Integer, default=0)
    video_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class VideoExportModel(Base):
    """MP4 today; the shape already allows webm / gif / carousel."""
    __tablename__ = "video_exports"

    id: Mapped[str] = mapped_column(String(48), primary_key=True, default=lambda: _id("exp"))
    motion_project_id: Mapped[str] = mapped_column(ForeignKey("motion_comic_projects.id"), index=True)
    render_job_id: Mapped[str] = mapped_column(ForeignKey("render_jobs.id"))
    format: Mapped[str] = mapped_column(String(12), default="mp4")
    aspect_ratio: Mapped[str] = mapped_column(String(8), default="16:9")
    url: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(default=_now)
`,
  },
  {
    path: "app/api/v1/motion.py",
    language: "python",
    code: `"""Motion-comic API.

Naming follows the existing v1 conventions: plural resources, verbs as
sub-paths, 202 for anything queued.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models_motion import (
    DialogueLineModel, MotionProjectModel, RenderJobModel, VideoExportModel, VoiceProfileModel,
)
from app.motion import motion_service
from app.schemas_motion import (
    AutoBuildRequest, AutoBuildResponse, BubblePatch, CameraPatch, MotionProjectIn,
    MotionProjectOut, RegenerateVoiceRequest, RenderRequest, RenderStatusOut, VoiceProfileIn, VoiceProfileOut,
)
from app.tts.service import synthesize_line

router = APIRouter(prefix="/motion-comics", tags=["motion-comics"])
voices_router = APIRouter(prefix="/voices", tags=["voices"])
dialogue_router = APIRouter(prefix="/dialogue", tags=["dialogue"])


def _deps(request: Request):
    return request.app.state.storage, request.app.state.tts_providers, request.app.state.render_queue


async def _project(session: AsyncSession, motion_id: str) -> MotionProjectModel:
    p = await session.get(MotionProjectModel, motion_id)
    if not p:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Motion project not found.", "retryable": False}})
    return p


# ------------------------------------------------------- projects ----

@router.post("", response_model=MotionProjectOut, status_code=201)
async def create_motion_project(payload: MotionProjectIn, session: AsyncSession = Depends(get_session)):
    project = MotionProjectModel(**payload.model_dump())
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


@router.get("/{motion_id}", response_model=MotionProjectOut)
async def get_motion_project(motion_id: str, session: AsyncSession = Depends(get_session)):
    return await _project(session, motion_id)


# ------------------------------------------------------ auto-build ----

@router.post("/{motion_id}/auto-build", response_model=AutoBuildResponse)
async def auto_build(
    motion_id: str,
    payload: AutoBuildRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Panels -> voices -> durations -> timeline -> bubbles -> camera
    -> transitions -> sfx, in one call."""
    project = await _project(session, motion_id)
    storage, tts_providers, _ = _deps(request)
    if payload.aspect_ratio:
        project.aspect_ratio = payload.aspect_ratio
    return await motion_service.auto_build(
        session, storage, tts_providers, project,
        provider_name=payload.tts_provider, force_voices=payload.force_voices,
    )


# -------------------------------------------------------- timeline ----

@router.get("/{motion_id}/timeline")
async def get_timeline(motion_id: str, session: AsyncSession = Depends(get_session)):
    project = await _project(session, motion_id)
    return project.timeline or {"scenes": [], "duration": 0, "fps": project.fps, "version": 0}


@router.put("/{motion_id}/timeline")
async def put_timeline(motion_id: str, timeline: dict, session: AsyncSession = Depends(get_session)):
    project = await _project(session, motion_id)
    project.timeline = timeline
    project.total_duration = float(timeline.get("duration", 0))
    project.render_status = "draft"
    await session.commit()
    return project.timeline


@router.patch("/{motion_id}/scenes/{scene_id}/camera")
async def patch_camera(motion_id: str, scene_id: str, payload: CameraPatch, session: AsyncSession = Depends(get_session)):
    """Camera only — artwork and audio are untouched (and unbilled)."""
    project = await _project(session, motion_id)
    return await motion_service.update_camera(session, project, scene_id, payload.move)


@router.patch("/{motion_id}/bubbles/{dialogue_id}")
async def patch_bubble(motion_id: str, dialogue_id: str, payload: BubblePatch, session: AsyncSession = Depends(get_session)):
    """Bubble only. A text change flags the audio stale instead of
    silently paying for a new synthesis."""
    project = await _project(session, motion_id)
    return await motion_service.update_bubble(session, project, dialogue_id, payload.model_dump(exclude_none=True))


# ---------------------------------------------------------- voices ----

@router.post("/{motion_id}/generate-voices")
async def generate_voices(
    motion_id: str,
    payload: AutoBuildRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    project = await _project(session, motion_id)
    storage, tts_providers, _ = _deps(request)
    result = await motion_service.auto_build(
        session, storage, tts_providers, project,
        provider_name=payload.tts_provider, force_voices=payload.force_voices,
    )
    return {"synthesized": result["voices_synthesized"], "from_cache": result["voices_from_cache"]}


@dialogue_router.post("/{dialogue_id}/regenerate-voice")
async def regenerate_voice(
    dialogue_id: str,
    payload: RegenerateVoiceRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Voice only — the panel artwork is never re-rendered."""
    line = await session.get(DialogueLineModel, dialogue_id)
    if not line:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Dialogue line not found.", "retryable": False}})
    if payload.voice_profile_id:
        line.voice_profile_id = payload.voice_profile_id
    if payload.emotion:
        line.emotion = payload.emotion
    if payload.speed is not None:
        line.speed_override = payload.speed
    if payload.pitch is not None:
        line.pitch_override = payload.pitch

    storage, tts_providers, _ = _deps(request)
    asset, cached = await synthesize_line(
        session, storage, tts_providers, line, payload.tts_provider,
        request.app.state.settings.default_tts_provider, force=True,
    )
    line.audio_stale = False
    await session.commit()
    return {"dialogue_id": dialogue_id, "audio_url": asset.url, "duration": asset.duration, "cached": cached}


@voices_router.get("", response_model=list[VoiceProfileOut])
async def list_voices(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(VoiceProfileModel).order_by(VoiceProfileModel.label))
    return result.scalars().all()


@voices_router.post("", response_model=VoiceProfileOut, status_code=201)
async def create_voice(payload: VoiceProfileIn, session: AsyncSession = Depends(get_session)):
    profile = VoiceProfileModel(**payload.model_dump())
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


@voices_router.get("/providers")
async def tts_providers(request: Request):
    providers = request.app.state.tts_providers
    return {
        "default": request.app.state.settings.default_tts_provider,
        "providers": [p.info() for p in providers.values()],
        "note": (
            "No registered provider exposes a native Nigerian Pidgin locale. "
            "Pidgin dialogue is sent verbatim and voiced with the closest Nigerian English voice."
        ),
    }


# ---------------------------------------------------------- render ----

@router.post("/{motion_id}/render", response_model=RenderStatusOut, status_code=202)
async def start_render(motion_id: str, payload: RenderRequest, request: Request, session: AsyncSession = Depends(get_session)):
    project = await _project(session, motion_id)
    if not project.timeline:
        raise HTTPException(409, detail={"error": {"code": "NO_TIMELINE", "message": "Run auto-build before rendering.", "retryable": False}})

    job = RenderJobModel(
        motion_project_id=project.id,
        format=payload.format,
        aspect_ratio=payload.aspect_ratio or project.aspect_ratio,
        status="queued",
        total_panels=len(project.timeline.get("scenes", [])),
    )
    session.add(job)
    project.render_status = "queued"
    await session.commit()
    await session.refresh(job)

    _, _, queue = _deps(request)
    await queue.enqueue(job.id)          # rendering never blocks the request
    return job


@router.get("/{motion_id}/render-status", response_model=RenderStatusOut)
async def render_status(motion_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(RenderJobModel).where(RenderJobModel.motion_project_id == motion_id)
        .order_by(RenderJobModel.created_at.desc()).limit(1)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "No render job for this project.", "retryable": False}})
    return job


@router.post("/{motion_id}/render/{job_id}/cancel", response_model=RenderStatusOut)
async def cancel_render(motion_id: str, job_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    job = await session.get(RenderJobModel, job_id)
    if not job:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Render job not found.", "retryable": False}})
    if job.status in ("completed", "failed"):
        raise HTTPException(409, detail={"error": {"code": "ALREADY_FINISHED", "message": f"Render already {job.status}.", "retryable": False}})
    _, _, queue = _deps(request)
    await queue.cancel(job_id)
    job.status = "cancelled"
    await session.commit()
    return job


@router.get("/{motion_id}/export")
async def export(motion_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(VideoExportModel).where(VideoExportModel.motion_project_id == motion_id)
        .order_by(VideoExportModel.created_at.desc())
    )
    exports = result.scalars().all()
    if not exports:
        raise HTTPException(404, detail={"error": {"code": "NOT_FOUND", "message": "Nothing exported yet.", "retryable": False}})
    return {"exports": [
        {"id": e.id, "format": e.format, "aspect_ratio": e.aspect_ratio,
         "url": e.url, "size_bytes": e.size_bytes, "duration": e.duration}
        for e in exports
    ]}
`,
  },
  {
    path: "app/schemas_motion.py",
    language: "python",
    code: `"""Motion-layer contracts."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ASPECTS = {"16:9", "9:16", "1:1"}
BUBBLE_STYLES = {"speech", "shout", "whisper", "thought", "commentator", "narration", "crowd"}
CAMERA_MOVES = {
    "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down",
    "focus_character", "focus_center", "shake", "slow_drift",
}


class VoiceProfileIn(BaseModel):
    character_id: Optional[str] = None
    label: str = Field(min_length=1, max_length=140)
    provider: str = "azure"
    voice_id: str = Field(min_length=1, max_length=120)
    language: str = "en-NG"
    language_label: str = "Nigerian Pidgin"
    accent: str = "Nigerian"
    gender: str = "male"
    age_style: str = "adult"
    default_emotion: str = "confident"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    pitch: float = Field(default=1.0, ge=0.5, le=2.0)
    volume: float = Field(default=1.0, ge=0.0, le=1.0)
    bubble_style: str = "speech"
    notes: str = ""

    @field_validator("bubble_style")
    @classmethod
    def _style(cls, v: str) -> str:
        if v not in BUBBLE_STYLES:
            raise ValueError(f"bubble_style must be one of {sorted(BUBBLE_STYLES)}")
        return v


class VoiceProfileOut(VoiceProfileIn):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class DialogueLineIn(BaseModel):
    panel_id: str
    order: int = Field(ge=1, le=200)
    speaker_label: str = Field(min_length=1, max_length=120)
    character_id: Optional[str] = None
    voice_profile_id: str
    text: str = Field(min_length=1, max_length=800)
    language_label: str = "Nigerian Pidgin"
    kind: str = "speech"
    bubble_style: str = "speech"
    emotion: str = "confident"
    speed_override: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    pitch_override: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    priority: int = 1


class MotionProjectIn(BaseModel):
    comic_project_id: str
    title: str = Field(min_length=1, max_length=200)
    aspect_ratio: str = "16:9"
    fps: int = Field(default=30, ge=12, le=60)

    @field_validator("aspect_ratio")
    @classmethod
    def _aspect(cls, v: str) -> str:
        if v not in ASPECTS:
            raise ValueError(f"aspect_ratio must be one of {sorted(ASPECTS)}")
        return v


class MotionProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    comic_project_id: str
    title: str
    aspect_ratio: str
    fps: int
    total_duration: float
    timeline: Optional[dict]
    audio_settings: dict
    render_status: str
    video_url: Optional[str]
    created_at: datetime
    updated_at: datetime


class AutoBuildRequest(BaseModel):
    tts_provider: Optional[str] = None
    aspect_ratio: Optional[str] = None
    force_voices: bool = False          # ignore the audio cache (re-bills)


class AutoBuildResponse(BaseModel):
    project_id: str
    status: str
    total_panels: int
    total_duration: float
    voices_synthesized: int
    voices_from_cache: int
    warnings: list[str] = []


class CameraPatch(BaseModel):
    move: str

    @field_validator("move")
    @classmethod
    def _move(cls, v: str) -> str:
        if v not in CAMERA_MOVES:
            raise ValueError(f"move must be one of {sorted(CAMERA_MOVES)}")
        return v


class BubblePatch(BaseModel):
    text: Optional[str] = Field(default=None, max_length=800)
    bubble_style: Optional[str] = None
    anchor: Optional[list[float]] = None


class RegenerateVoiceRequest(BaseModel):
    voice_profile_id: Optional[str] = None
    emotion: Optional[str] = None
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    pitch: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    tts_provider: Optional[str] = None


class RenderRequest(BaseModel):
    format: str = "mp4"
    aspect_ratio: Optional[str] = None

    @field_validator("format")
    @classmethod
    def _fmt(cls, v: str) -> str:
        if v not in {"mp4"}:            # webm / gif / carousel are next, not faked now
            raise ValueError("only 'mp4' is currently supported")
        return v


class RenderStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    motion_project_id: str
    status: str
    progress: int
    current_panel: int
    total_panels: int
    format: str
    aspect_ratio: str
    video_url: Optional[str]
    size_bytes: Optional[int]
    error: Optional[dict]
    created_at: datetime
    completed_at: Optional[datetime]
`,
  },
  {
    path: "app/seed_motion.py",
    language: "python",
    code: `"""Motion demo seed — the 5-panel acceptance test from the brief.

Voice bible for the existing fictional characters + Nigerian-Pidgin
dialogue attached to the 5 seeded panels.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models_motion import DialogueLineModel, MotionProjectModel, VoiceProfileModel

log = logging.getLogger("bryme.seed.motion")

VOICES = [
    dict(id="vp-city-midfielder", character_id="city-creative-midfielder", label="Creative Midfielder — playful Naija",
         provider="azure", voice_id="en-NG-AbeoNeural", language="en-NG", language_label="Nigerian Pidgin",
         accent="Nigerian", gender="male", age_style="mid-twenties", default_emotion="confident",
         speed=1.0, pitch=1.06, bubble_style="speech"),
    dict(id="vp-city-defender", character_id="city-defender-01", label="Towering Centre-Back — deep, euphoric",
         provider="azure", voice_id="en-NG-AbeoNeural", language="en-NG", language_label="Nigerian Pidgin",
         accent="Nigerian", gender="male", age_style="late twenties", default_emotion="excited",
         speed=1.04, pitch=0.88, bubble_style="shout"),
    dict(id="vp-bou-keeper", character_id="bou-keeper-01", label="Shot-Stopper — defiant",
         provider="azure", voice_id="en-GB-RyanNeural", language="en-GB", language_label="English",
         accent="British", gender="male", age_style="early thirties", default_emotion="defiant",
         speed=1.08, pitch=0.95, bubble_style="shout"),
    dict(id="vp-commentator", character_id=None, label="Commentary box — broadcast energy",
         provider="azure", voice_id="en-GB-ThomasNeural", language="en-GB", language_label="English",
         accent="British", gender="male", age_style="forties", default_emotion="energetic",
         speed=1.14, pitch=1.0, bubble_style="commentator"),
    dict(id="vp-narrator", character_id=None, label="Narrator — measured Naija",
         provider="azure", voice_id="en-NG-EzinneNeural", language="en-NG", language_label="Nigerian English",
         accent="Nigerian", gender="female", age_style="adult", default_emotion="calm",
         speed=0.94, pitch=1.0, bubble_style="narration"),
    dict(id="vp-crowd", character_id=None, label="Crowd — massed chant",
         provider="azure", voice_id="en-NG-AbeoNeural", language="en-NG", language_label="Nigerian Pidgin",
         accent="Nigerian", gender="male", age_style="crowd", default_emotion="roaring",
         speed=0.9, pitch=0.8, bubble_style="crowd"),
]

DIALOGUE = [
    ("panel-01", 1, "Narrator", "vp-narrator", "Ninety minutes. Two teams. One storyline.", "narration", "narration", "Nigerian English", "calm"),
    ("panel-01", 2, "City Captain", "vp-city-midfielder", "Make we just start this thing abeg.", "speech", "speech", "Nigerian Pidgin", "playful"),
    ("panel-07", 1, "Keeper", "vp-bou-keeper", "NOT TODAY! You hear me?! NOT TODAY!", "shout", "shout", "English", "defiant"),
    ("panel-07", 2, "Commentator", "vp-commentator", "That is simply outrageous goalkeeping.", "commentary", "commentator", "English", "energetic"),
    ("panel-12", 1, "City Midfielder", "vp-city-midfielder", "Ref abeg, na handball! Everybody see am!", "speech", "speech", "Nigerian Pidgin", "mocking"),
    ("panel-12", 2, "Crowd", "vp-crowd", "V! A! R! V! A! R!", "crowd", "crowd", "Nigerian Pidgin", "roaring"),
    ("panel-20", 1, "City Player", "vp-city-defender", "Omo, we don win am!", "shout", "shout", "Nigerian Pidgin", "excited"),
    ("panel-20", 2, "Commentator", "vp-commentator", "At the DEATH! The champions-elect! Unbelievable scenes!", "commentary", "commentator", "English", "energetic"),
    ("panel-21", 1, "Crowd", "vp-crowd", "WE GO WIN AM! WE GO WIN AM!", "crowd", "crowd", "Nigerian Pidgin", "roaring"),
]


async def seed_motion_demo(session_factory: async_sessionmaker) -> None:
    async with session_factory() as session:
        if await session.get(MotionProjectModel, "mc_citybou_01"):
            return

        for v in VOICES:
            session.add(VoiceProfileModel(**v))

        for panel_id, order, speaker, vp, text, kind, style, lang, emotion in DIALOGUE:
            session.add(DialogueLineModel(
                id=f"{panel_id}-l{order}", panel_id=panel_id, order=order,
                speaker_label=speaker, voice_profile_id=vp,
                text=text,                      # verbatim Pidgin
                language_label=lang, kind=kind, bubble_style=style,
                emotion=emotion, priority=order,
            ))

        session.add(MotionProjectModel(
            id="mc_citybou_01",
            comic_project_id="proj-city-bou",
            title="Manchester City vs Bournemouth — Motion Comic",
            aspect_ratio="16:9", fps=30,
        ))
        await session.commit()
        log.info("motion demo seeded — %s voices, %s dialogue lines", len(VOICES), len(DIALOGUE))
`,
  },
  {
    path: "tests/test_motion.py",
    language: "python",
    code: `"""Motion-layer tests. No paid TTS call is ever made (mock provider
+ respx for the HTTP adapters)."""
from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
import respx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.motion.bubbles import place_bubble
from app.motion.camera import build_camera, camera_move_for, MAX_SCALE
from app.motion.timeline import ASPECTS, LEAD_IN, build_scene, sequence
from app.motion.transitions import transition_for, xfade_name
from app.tts.base import TTSError, voice_cache_key
from app.tts.duration import estimate_duration, wav_duration
from app.tts.providers.azure_provider import AzureSpeechProvider
from app.tts.providers.mock_provider import MockTTSProvider


# ------------------------------------------------------ fixtures ----

class FakePanel:
    def __init__(self, pid, number, event=None, image="/img/x.jpg"):
        self.id = pid
        self.number = number
        self.title = f"Panel {number}"
        self.scene = "a scene"
        self.event = event
        self.image_url = image


class FakeLine:
    def __init__(self, lid, order, speaker, text, style="speech"):
        self.id = lid
        self.order = order
        self.speaker_label = speaker
        self.text = text
        self.bubble_style = style


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


# ------------------------------------------------------- duration ----

def test_duration_estimate_scales_with_length():
    short = estimate_duration("Omo!", 1.0, "excited")
    long = estimate_duration("Omo, we don win am! Na so we dey do am for this Manchester!", 1.0, "excited")
    assert long > short > 0.5


def test_duration_estimate_respects_speed():
    slow = estimate_duration("Make we just start this thing abeg.", 0.8)
    fast = estimate_duration("Make we just start this thing abeg.", 1.3)
    assert slow > fast


@pytest.mark.asyncio
async def test_mock_tts_returns_playable_wav_of_exact_length():
    p = MockTTSProvider()
    r = await p.generate("Omo, we don win am!", "voice-x", "en-NG", "excited", 1.0, 1.0)
    assert r.audio[:4] == b"RIFF"
    measured = wav_duration(r.audio)
    assert measured is not None
    assert abs(measured - r.duration) < 0.05      # header length matches the promise


# ------------------------------------------------------ pidgin ----

@pytest.mark.asyncio
async def test_pidgin_text_is_never_rewritten():
    text = "Omo, wetin this guy dey do?"
    p = MockTTSProvider()
    r = await p.generate(text, "v", "en-NG", "mocking", 1.0, 1.0)
    assert r.meta["chars"] == str(len(text))      # nothing added or stripped


def test_azure_ssml_preserves_pidgin_verbatim():
    p = AzureSpeechProvider("key", "westeurope")
    ssml = p._ssml("Omo, we don win am!", "en-NG-AbeoNeural", "en-NG", "excited", 1.0, 1.0)
    assert "Omo, we don win am!" in ssml
    assert 'name="en-NG-AbeoNeural"' in ssml
    assert "express-as" in ssml


def test_no_provider_claims_native_pidgin():
    for provider in (MockTTSProvider(), AzureSpeechProvider("k")):
        assert provider.capabilities.native_pidgin_locale is False


@pytest.mark.asyncio
@respx.mock
async def test_azure_rate_limit_normalized():
    respx.post(respx.patterns.M(host__regex=r".*tts\\.speech\\.microsoft\\.com")).mock(
        return_value=httpx.Response(429)
    )
    p = AzureSpeechProvider("key", "westeurope")
    with pytest.raises(TTSError) as exc:
        await p.generate("hi", "en-NG-AbeoNeural", "en-NG")
    assert exc.value.code == "TTS_RATE_LIMIT"
    assert exc.value.retryable is True


# -------------------------------------------------------- caching ----

def test_cache_key_is_stable_and_setting_sensitive():
    a = voice_cache_key("Omo!", "v1", "en-NG", "excited", 1.0, 1.0)
    b = voice_cache_key("Omo!", "v1", "en-NG", "excited", 1.0, 1.0)
    c = voice_cache_key("Omo!", "v1", "en-NG", "calm", 1.0, 1.0)
    assert a == b
    assert a != c        # emotion change = new take = new bill


# ------------------------------------------------------- timeline ----

def test_timeline_is_driven_by_audio_duration():
    panel = FakePanel("panel-20", 20, {"type": "goal", "minute": "90+1"})
    lines = [FakeLine("l1", 1, "City Player", "Omo, we don win am!", "shout")]
    scene = build_scene(panel=panel, lines=lines, durations={"l1": 2.0}, aspect="16:9")

    audio = [e for e in scene.elements if e["type"] == "audio"][0]
    assert audio["start"] == pytest.approx(LEAD_IN)
    assert audio["end"] == pytest.approx(LEAD_IN + 2.0)

    # a longer take must push the scene out
    longer = build_scene(panel=panel, lines=lines, durations={"l1": 5.0}, aspect="16:9")
    assert longer.duration > scene.duration


def test_bubble_follows_its_audio():
    panel = FakePanel("panel-07", 7, {"type": "save"})
    lines = [FakeLine("l1", 1, "Keeper", "NOT TODAY!", "shout")]
    scene = build_scene(panel=panel, lines=lines, durations={"l1": 1.5}, aspect="16:9")
    bubble = [e for e in scene.elements if e["type"] == "speech_bubble"][0]
    audio = [e for e in scene.elements if e["type"] == "audio"][0]
    assert bubble["start"] <= audio["start"]         # lands just before the voice
    assert bubble["end"] > audio["end"]              # lingers after it


def test_two_speakers_are_sequential_not_overlapping():
    panel = FakePanel("panel-01", 1, {"type": "kickoff"})
    lines = [FakeLine("l1", 1, "A", "First line."), FakeLine("l2", 2, "B", "Second line.")]
    scene = build_scene(panel=panel, lines=lines, durations={"l1": 1.2, "l2": 1.4}, aspect="16:9")
    a1, a2 = [e for e in scene.elements if e["type"] == "audio"]
    assert a2["start"] > a1["end"]


def test_dialogue_text_survives_into_the_timeline():
    pidgin = "Ref abeg, na handball! Everybody see am!"
    panel = FakePanel("panel-12", 12, {"type": "var"})
    scene = build_scene(panel=panel, lines=[FakeLine("l1", 1, "Mid", pidgin)], durations={"l1": 2.0}, aspect="16:9")
    bubble = [e for e in scene.elements if e["type"] == "speech_bubble"][0]
    assert bubble["text"] == pidgin


def test_sequence_stacks_offsets():
    panel = FakePanel("p", 1, {"type": "goal"})
    scenes = [build_scene(panel=panel, lines=[], durations={}, aspect="16:9") for _ in range(3)]
    tl = sequence(scenes, fps=30)
    assert tl["scenes"][0]["offset"] == 0
    assert tl["scenes"][1]["offset"] == pytest.approx(tl["scenes"][0]["duration"])
    assert tl["duration"] == pytest.approx(sum(s["duration"] for s in scenes))


# --------------------------------------------------------- camera ----

def test_event_drives_camera_and_shake():
    assert camera_move_for("goal") == "zoom_in"
    assert camera_move_for("kickoff") == "zoom_out"
    assert camera_move_for(None) == "slow_drift"
    track = build_camera("zoom_in", 5.0, (0.43, 0.42), "goal")
    assert track.shakes and track.shakes[0]["intensity"] == 1.0


def test_camera_never_exceeds_safe_scale():
    for move in ("zoom_in", "zoom_out", "focus_character", "slow_drift", "shake"):
        for kf in build_camera(move, 4.0, (0.4, 0.4), "goal").keyframes:
            assert kf.scale <= MAX_SCALE


def test_missing_focus_falls_back_to_centre():
    track = build_camera("focus_character", 4.0, None, None)
    assert track.keyframes[-1].x == 0.5 and track.keyframes[-1].y == 0.5


# --------------------------------------------------- safe zones ----

def test_bubbles_respect_tiktok_safe_zone():
    safe = ASPECTS["9:16"]["safe"]
    for i in range(4):
        x, y = place_bubble(i, 4, safe, None, "speech")
        assert safe["left"] <= x <= 1 - safe["right"]
        assert safe["top"] <= y <= 1 - safe["bottom"]
        assert y < 1 - safe["bottom"]        # clear of the caption/UI band


def test_scene_warns_when_focus_metadata_is_absent():
    panel = FakePanel("panel-99", 99, {"type": "goal"})
    scene = build_scene(panel=panel, lines=[], durations={}, aspect="16:9", focus_hint=None)
    assert any("centre framing" in w for w in scene.warnings)


# ----------------------------------------------------- transitions ----

def test_transition_selection_and_xfade_mapping():
    assert transition_for("goal") == "flash"
    assert transition_for("var") == "dip_to_black"
    assert xfade_name("flash") == "fadewhite"
    assert xfade_name("cut") is None


# ------------------------------------------------------ sfx layer ----

def test_goal_gets_impact_and_roar():
    panel = FakePanel("panel-20", 20, {"type": "goal"})
    scene = build_scene(panel=panel, lines=[], durations={}, aspect="16:9", sfx_enabled=True)
    ids = {e["sfx"] for e in scene.elements if e["type"] == "sfx"}
    assert {"goal_impact", "crowd_roar"} <= ids


def test_sfx_can_be_disabled_without_touching_dialogue():
    panel = FakePanel("panel-20", 20, {"type": "goal"})
    lines = [FakeLine("l1", 1, "A", "Goal!")]
    scene = build_scene(panel=panel, lines=lines, durations={"l1": 1.0},
                        aspect="16:9", sfx_enabled=False, ambience_enabled=False)
    assert not [e for e in scene.elements if e["type"] == "sfx"]
    assert [e for e in scene.elements if e["type"] == "audio"]


# -------------------------------------------------- aspect ratios ----

@pytest.mark.parametrize("aspect,w,h", [("16:9", 1920, 1080), ("9:16", 1080, 1920), ("1:1", 1080, 1080)])
def test_all_aspects_supported(aspect, w, h):
    assert ASPECTS[aspect]["w"] == w and ASPECTS[aspect]["h"] == h
    panel = FakePanel("p", 1, {"type": "goal"})
    scene = build_scene(panel=panel, lines=[FakeLine("l1", 1, "A", "Test line here.")],
                        durations={"l1": 1.0}, aspect=aspect)
    assert scene.duration > 0
`,
  },
];

