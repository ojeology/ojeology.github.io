/* ============================================================
   BRYME MOTION — TTS provider abstraction + Voice Bible
   Same contract as the image ImageProvider layer: adapters declare
   capabilities honestly, errors are normalized, nothing is faked.
   ============================================================ */

import type { AudioAsset, DialogueLine, TTSProviderId, VoiceProfile } from "./types";

/* --------------------------------------------- voice bible ---- */

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "vp-city-midfielder",
    character_id: "city-creative-midfielder",
    label: "Creative Midfielder — playful Naija",
    provider: "browser",
    voice_id: "auto:en-NG|en-GB-male",
    language: "en-NG",
    language_label: "Nigerian Pidgin",
    accent: "Nigerian",
    gender: "male",
    age_style: "mid-twenties",
    default_emotion: "confident",
    speed: 1.0,
    pitch: 1.06,
    volume: 1,
    bubble_style: "speech",
    notes: "Chief banter officer — most Pidgin lines route here.",
  },
  {
    id: "vp-city-defender",
    character_id: "city-defender-01",
    label: "Towering Centre-Back — deep, euphoric",
    provider: "browser",
    voice_id: "auto:en-NG|en-GB-male-deep",
    language: "en-NG",
    language_label: "Nigerian Pidgin",
    accent: "Nigerian",
    gender: "male",
    age_style: "late twenties",
    default_emotion: "excited",
    speed: 1.04,
    pitch: 0.88,
    volume: 1,
    bubble_style: "shout",
  },
  {
    id: "vp-bou-keeper",
    character_id: "bou-keeper-01",
    label: "Shot-Stopper — defiant",
    provider: "browser",
    voice_id: "auto:en-GB-male",
    language: "en-GB",
    language_label: "English",
    accent: "British",
    gender: "male",
    age_style: "early thirties",
    default_emotion: "defiant",
    speed: 1.08,
    pitch: 0.95,
    volume: 1,
    bubble_style: "shout",
  },
  {
    id: "vp-commentator",
    character_id: null,
    label: "Commentary box — broadcast energy",
    provider: "browser",
    voice_id: "auto:en-GB-male",
    language: "en-GB",
    language_label: "English",
    accent: "British",
    gender: "male",
    age_style: "forties",
    default_emotion: "energetic",
    speed: 1.14,
    pitch: 1.0,
    volume: 0.95,
    bubble_style: "commentator",
  },
  {
    id: "vp-narrator",
    character_id: null,
    label: "Narrator — measured Naija",
    provider: "browser",
    voice_id: "auto:en-NG|en-GB-female",
    language: "en-NG",
    language_label: "Nigerian English",
    accent: "Nigerian",
    gender: "female",
    age_style: "adult",
    default_emotion: "calm",
    speed: 0.94,
    pitch: 1.0,
    volume: 0.95,
    bubble_style: "narration",
  },
  {
    id: "vp-crowd",
    character_id: null,
    label: "Crowd — massed chant",
    provider: "browser",
    voice_id: "auto:any-male",
    language: "en-NG",
    language_label: "Nigerian Pidgin",
    accent: "Nigerian",
    gender: "neutral",
    age_style: "crowd",
    default_emotion: "roaring",
    speed: 0.9,
    pitch: 0.8,
    volume: 0.9,
    bubble_style: "crowd",
  },
];

export function voiceProfile(id: string): VoiceProfile {
  return VOICE_PROFILES.find((v) => v.id === id) ?? VOICE_PROFILES[0];
}

/** Maps authored speaker labels onto the voice bible. */
export const SPEAKER_MAP: Record<string, string> = {
  "City Player": "vp-city-defender",
  "City Captain": "vp-city-midfielder",
  "City Midfielder": "vp-city-midfielder",
  Keeper: "vp-bou-keeper",
  Commentator: "vp-commentator",
  Narrator: "vp-narrator",
  Crowd: "vp-crowd",
};

export function resolveVoice(speaker: string): VoiceProfile {
  return voiceProfile(SPEAKER_MAP[speaker] ?? "vp-narrator");
}

/* ------------------------------------------- provider layer ---- */

export interface TTSCapabilities {
  configured: boolean;
  exact_duration: boolean;   // returns real audio length, not an estimate
  emotion: boolean;
  speed: boolean;
  pitch: boolean;
  ssml: boolean;
  nigerian_english_voices: boolean;
  /* No mainstream TTS API exposes a Nigerian-Pidgin locale. We never
     claim otherwise: Pidgin text is spoken verbatim by a Nigerian
     English voice. */
  native_pidgin_locale: boolean;
  returns_audio_file: boolean;
}

export interface TTSRequest {
  text: string;
  voice: VoiceProfile;
  emotion?: string;
  speed?: number;
  pitch?: number;
  language: string;
}

export interface TTSResult {
  duration: number;
  duration_source: "measured" | "estimated";
  url: string | null;
  provider: TTSProviderId;
  voice_id: string;
  meta: Record<string, string>;
}

export class TTSError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface TTSProvider {
  id: TTSProviderId;
  label: string;
  model: string;
  notes: string;
  capabilities: TTSCapabilities;
  generate(req: TTSRequest): Promise<TTSResult>;
}

/* ----------------------------------------- duration model -----
   Timeline construction needs a length before audio exists. This
   estimator is deterministic: words / wpm, adjusted for emotion and
   punctuation pauses. Server-side providers overwrite it with the
   exact length probed from the returned audio file; the browser
   adapter reconciles it from measured playback.
--------------------------------------------------------------- */

const WPM_BY_EMOTION: Record<string, number> = {
  calm: 150, confident: 165, playful: 170, mocking: 158, defiant: 172,
  excited: 186, energetic: 192, roaring: 130, angry: 180, sad: 138,
};

export function estimateDuration(text: string, speed = 1, emotion = "confident"): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wpm = (WPM_BY_EMOTION[emotion] ?? 165) * speed;
  const base = (words / wpm) * 60;

  // punctuation breathing room
  const commas = (text.match(/[,;:]/g) ?? []).length * 0.16;
  const stops = (text.match(/[.!?]/g) ?? []).length * 0.28;
  const shouts = (text.match(/!/g) ?? []).length * 0.06;
  const ellipses = (text.match(/…|\.\.\./g) ?? []).length * 0.35;

  // ALL-CAPS words are delivered harder and slower
  const caps = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length * 0.12;

  return Math.max(0.7, +(base + commas + stops + shouts + ellipses + caps).toFixed(3));
}

export function cacheKey(req: TTSRequest): string {
  const raw = [
    req.text, req.voice.id, req.voice.voice_id, req.language,
    req.emotion ?? req.voice.default_emotion,
    (req.speed ?? req.voice.speed).toFixed(2),
    (req.pitch ?? req.voice.pitch).toFixed(2),
  ].join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `tts_${(h >>> 0).toString(16)}`;
}

/* ------------------------------------------ browser adapter ----
   Uses the Web Speech API — genuinely audible in preview, zero cost,
   zero credentials. It cannot hand back an audio file or an exact
   duration up front, so we estimate for timeline construction and
   reconcile against measured playback. Declared honestly below.
--------------------------------------------------------------- */

export class BrowserSpeechProvider implements TTSProvider {
  id = "browser" as const;
  label = "Browser Speech (Web Speech API)";
  model = "system-voices";
  notes = "Local OS voices. Free, instant, no file output — preview-grade.";

  capabilities: TTSCapabilities = {
    configured: typeof window !== "undefined" && "speechSynthesis" in window,
    exact_duration: false,
    emotion: false,
    speed: true,
    pitch: true,
    ssml: false,
    nigerian_english_voices: false,
    native_pidgin_locale: false,
    returns_audio_file: false,
  };

  async generate(req: TTSRequest): Promise<TTSResult> {
    if (!this.capabilities.configured) {
      throw new TTSError("TTS_NOT_AVAILABLE", "This browser exposes no speechSynthesis engine.", false);
    }
    const speed = req.speed ?? req.voice.speed;
    const duration = estimateDuration(req.text, speed, req.emotion ?? req.voice.default_emotion);
    const picked = pickBrowserVoice(req.voice);
    return {
      duration,
      duration_source: "estimated",
      url: null,
      provider: this.id,
      voice_id: picked?.name ?? req.voice.voice_id,
      meta: {
        engine: "web-speech",
        matched_voice: picked?.name ?? "system default",
        matched_lang: picked?.lang ?? "n/a",
      },
    };
  }
}

let voiceCache: SpeechSynthesisVoice[] = [];
export function browserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) voiceCache = v;
  return voiceCache;
}

/** Best-effort match: exact locale → language family → gender hint. */
export function pickBrowserVoice(profile: VoiceProfile): SpeechSynthesisVoice | undefined {
  const voices = browserVoices();
  if (!voices.length) return undefined;
  const wants = profile.voice_id.replace("auto:", "").split("|");

  for (const want of wants) {
    const [lang] = want.split("-male").join("").split("-female");
    const exact = voices.find((v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase());
    if (exact) return exact;
  }
  const family = profile.language.split("-")[0];
  const sameFamily = voices.filter((v) => v.lang.toLowerCase().startsWith(family));
  if (sameFamily.length) {
    const wantFemale = profile.gender === "female";
    const byName = sameFamily.find((v) =>
      wantFemale ? /female|samantha|zira|karen|fiona|tessa/i.test(v.name) : /male|daniel|david|alex|george|fred/i.test(v.name)
    );
    return byName ?? sameFamily[0];
  }
  return voices[0];
}

/* -------------------------------------- server-side adapters ----
   Registered so the engine can select them; unconfigured in-browser
   because credentials live on the server. Full httpx implementations
   ship in app/tts/providers/* in the Source bundle.
--------------------------------------------------------------- */

function serverAdapter(
  id: TTSProviderId,
  label: string,
  model: string,
  notes: string,
  caps: Partial<TTSCapabilities>
): TTSProvider {
  return {
    id,
    label,
    model,
    notes,
    capabilities: {
      configured: false,
      exact_duration: true,
      emotion: false,
      speed: true,
      pitch: false,
      ssml: false,
      nigerian_english_voices: false,
      native_pidgin_locale: false,
      returns_audio_file: true,
      ...caps,
    },
    async generate() {
      throw new TTSError(
        "TTS_NOT_CONFIGURED",
        `${label} is registered but no API key is configured in this environment. Set its credential server-side, or use the browser adapter for preview.`,
        false
      );
    },
  };
}

export const TTS_PROVIDERS: Record<TTSProviderId, TTSProvider> = {
  browser: new BrowserSpeechProvider(),
  elevenlabs: serverAdapter(
    "elevenlabs",
    "ElevenLabs",
    "eleven_multilingual_v2",
    "Cloned//library voices, expressive. Nigerian-accented voices exist in the community library; no Pidgin locale.",
    { emotion: true, ssml: false, nigerian_english_voices: true, pitch: false }
  ),
  azure: serverAdapter(
    "azure",
    "Azure AI Speech",
    "en-NG-EzinneNeural / en-NG-AbeoNeural",
    "Ships genuine en-NG Nigerian English neural voices and SSML prosody/style control.",
    { emotion: true, ssml: true, nigerian_english_voices: true, pitch: true }
  ),
  mock: serverAdapter("mock", "Mock TTS", "bryme/silent-wav", "Deterministic silent WAV of exact computed length — CI and offline tests.", {
    configured: false,
  }),
};

/* -------------------------------------------------- cache ----
   Cost control: identical (text + voice + settings) never bills twice.
--------------------------------------------------------------- */

export class AudioCache {
  private map = new Map<string, AudioAsset>();
  hits = 0;
  misses = 0;

  get(key: string): AudioAsset | undefined {
    const hit = this.map.get(key);
    if (hit) this.hits++;
    return hit;
  }
  set(asset: AudioAsset) {
    this.map.set(asset.cache_key, asset);
    this.misses++;
  }
  invalidate(dialogueId: string) {
    for (const [k, v] of this.map) if (v.dialogue_id === dialogueId) this.map.delete(k);
  }
  get size() {
    return this.map.size;
  }
  all(): AudioAsset[] {
    return [...this.map.values()];
  }
}

/** Synthesize one line through the selected adapter, honoring the cache. */
export async function synthesize(
  line: DialogueLine,
  providerId: TTSProviderId,
  cache: AudioCache
): Promise<{ asset: AudioAsset; cached: boolean }> {
  const voice = voiceProfile(line.voice_profile_id);
  const req: TTSRequest = {
    text: line.text,                       // verbatim — no translation, no cleanup
    voice,
    emotion: line.emotion,
    speed: line.speed_override ?? voice.speed,
    pitch: line.pitch_override ?? voice.pitch,
    language: voice.language,
  };
  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit) return { asset: hit, cached: true };

  const provider = TTS_PROVIDERS[providerId];
  if (!provider) throw new TTSError("TTS_NOT_CONFIGURED", `No TTS adapter registered for "${providerId}".`, false);

  const result = await provider.generate(req);
  const asset: AudioAsset = {
    id: `aud_${key.slice(4)}`,
    dialogue_id: line.id,
    provider: result.provider,
    voice_id: result.voice_id,
    cache_key: key,
    duration: result.duration,
    duration_source: result.duration_source,
    url: result.url,
    characters: line.text.length,
    created_at: new Date().toISOString(),
    meta: result.meta,
  };
  cache.set(asset);
  return { asset, cached: false };
}

