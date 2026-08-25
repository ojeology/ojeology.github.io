/* ============================================================
   BRYME MOTION COMIC — domain models
   Layer 2 on top of the existing image engine. Panels + dialogue
   in, timeline + video out. Mirrors app/motion/* in the backend.
   ============================================================ */

import type { EventType } from "../core";

/* ---------------------------------------------------- voice ---- */

export type TTSProviderId = "browser" | "elevenlabs" | "azure" | "mock";

export interface VoiceProfile {
  id: string;
  character_id: string | null;   // null = non-diegetic (narrator / crowd)
  label: string;
  provider: TTSProviderId;
  voice_id: string;
  language: string;              // BCP-47 — en-NG, en-GB
  language_label: string;        // "Nigerian Pidgin", "Nigerian English"
  accent: string;
  gender: "male" | "female" | "neutral";
  age_style: string;
  default_emotion: string;
  speed: number;                 // 0.5 – 2.0
  pitch: number;                 // 0.5 – 2.0
  volume: number;                // 0 – 1
  bubble_style: BubbleStyle;
  notes?: string;
}

/* ------------------------------------------------- dialogue ---- */

export type DialogueKindX =
  | "speech" | "narration" | "commentary" | "crowd"
  | "shout" | "whisper" | "sound_effect";

export type BubbleStyle =
  | "speech" | "shout" | "whisper" | "thought"
  | "commentator" | "narration" | "crowd";

export type BubbleAnim =
  | "fade_in" | "pop_in" | "slide_in" | "bounce_in" | "shake_in";

export interface DialogueLine {
  id: string;
  panel_id: string;
  order: number;
  speaker_label: string;         // as authored ("City Player")
  character_id: string | null;
  voice_profile_id: string;
  text: string;                  // PRESERVED VERBATIM — never rewritten/translated
  language_label: string;
  kind: DialogueKindX;
  bubble_style: BubbleStyle;
  emotion: string;
  /* per-line overrides of the voice bible */
  speed_override?: number;
  pitch_override?: number;
  /* normalized anchor 0..1 for bubble placement; undefined = auto */
  anchor?: { x: number; y: number };
  priority: number;
}

/* ------------------------------------------------ tts result ---- */

export interface AudioAsset {
  id: string;
  dialogue_id: string;
  provider: TTSProviderId;
  voice_id: string;
  /* content hash of text+voice+settings — the cache key that stops
     us paying for the same line twice */
  cache_key: string;
  duration: number;              // seconds
  duration_source: "measured" | "estimated";
  url: string | null;            // object-storage URL (server) / null in browser
  characters: number;
  created_at: string;
  meta: Record<string, string>;
}

/* -------------------------------------------------- camera ---- */

export type CameraMove =
  | "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down"
  | "focus_character" | "focus_center" | "shake" | "slow_drift";

export interface CameraKeyframe {
  t: number;                     // seconds, relative to panel
  scale: number;                 // 1.0 = fit
  x: number;                     // normalized focal point 0..1
  y: number;
}

export interface CameraTrack {
  move: CameraMove;
  keyframes: CameraKeyframe[];
  shakes: { start: number; end: number; intensity: number }[];
}

/* ---------------------------------------------- transitions ---- */

export type TransitionKind = "cut" | "crossfade" | "dip_to_black" | "whip_pan" | "flash";

/* ------------------------------------------------ timeline ---- */

export type ElementType =
  | "image" | "camera" | "speech_bubble" | "audio" | "sfx" | "transition" | "music";

export interface TimelineElement {
  id: string;
  type: ElementType;
  start: number;                 // absolute seconds within the scene
  end: number;
  /* image */
  source?: string;
  /* bubble */
  speaker?: string;
  text?: string;
  bubble_style?: BubbleStyle;
  anim_in?: BubbleAnim;
  anim_out?: "fade_out" | "pop_out";
  anchor?: { x: number; y: number };
  /* audio */
  dialogue_id?: string;
  gain?: number;
  /* camera */
  camera?: CameraTrack;
  /* sfx */
  sfx?: SfxId;
  /* transition */
  transition?: TransitionKind;
}

export interface Scene {
  id: string;                    // = panel id
  panel_id: string;
  panel_number: number;
  title: string;
  image_url: string | null;
  event_type?: EventType;
  duration: number;
  offset: number;                // absolute start in the full film
  elements: TimelineElement[];
  transition_out: TransitionKind;
  focus_character?: string | null;
  focus_hint?: { x: number; y: number } | null;   // reliable metadata only
  warnings: string[];
}

export interface MotionTimeline {
  scenes: Scene[];
  duration: number;
  fps: number;
  version: number;
}

/* ---------------------------------------------------- sfx ---- */

export type SfxId =
  | "crowd_ambience" | "crowd_roar" | "crowd_gasp" | "boo" | "cheer"
  | "whistle" | "goal_impact" | "kick" | "net_ripple" | "laugh"
  | "shock_sting" | "camera_hit" | "transition_swell";

export interface SfxSpec {
  id: SfxId;
  label: string;
  /* synthesized in-browser from primitives; server side maps to a
     licensed CC0 asset file. No broadcast audio, ever. */
  synth: "noise_swell" | "noise_burst" | "whistle" | "impact" | "sweep" | "chatter";
  gain: number;
  duration: number;
  license: string;
}

export const SFX_LIBRARY: Record<SfxId, SfxSpec> = {
  crowd_ambience:   { id: "crowd_ambience",   label: "Stadium ambience", synth: "chatter",     gain: 0.10, duration: 6.0, license: "CC0 / original synthesis" },
  crowd_roar:       { id: "crowd_roar",       label: "Crowd roar",       synth: "noise_swell", gain: 0.34, duration: 2.6, license: "CC0 / original synthesis" },
  crowd_gasp:       { id: "crowd_gasp",       label: "Crowd gasp",       synth: "noise_swell", gain: 0.22, duration: 1.2, license: "CC0 / original synthesis" },
  boo:              { id: "boo",              label: "Boos",             synth: "chatter",     gain: 0.24, duration: 2.2, license: "CC0 / original synthesis" },
  cheer:            { id: "cheer",            label: "Cheer",            synth: "noise_swell", gain: 0.28, duration: 2.0, license: "CC0 / original synthesis" },
  whistle:          { id: "whistle",          label: "Referee whistle",  synth: "whistle",     gain: 0.30, duration: 0.7, license: "CC0 / original synthesis" },
  goal_impact:      { id: "goal_impact",      label: "Goal impact",      synth: "impact",      gain: 0.42, duration: 0.8, license: "CC0 / original synthesis" },
  kick:             { id: "kick",             label: "Ball strike",      synth: "impact",      gain: 0.30, duration: 0.35, license: "CC0 / original synthesis" },
  net_ripple:       { id: "net_ripple",       label: "Net ripple",       synth: "noise_burst", gain: 0.18, duration: 0.6, license: "CC0 / original synthesis" },
  laugh:            { id: "laugh",            label: "Crowd laugh",      synth: "chatter",     gain: 0.20, duration: 1.6, license: "CC0 / original synthesis" },
  shock_sting:      { id: "shock_sting",      label: "Shock sting",      synth: "sweep",       gain: 0.26, duration: 1.0, license: "CC0 / original synthesis" },
  camera_hit:       { id: "camera_hit",       label: "Camera hit",       synth: "impact",      gain: 0.22, duration: 0.3, license: "CC0 / original synthesis" },
  transition_swell: { id: "transition_swell", label: "Transition swell", synth: "sweep",       gain: 0.20, duration: 0.9, license: "CC0 / original synthesis" },
};

/* ------------------------------------------- motion project ---- */

export type RenderStatus = "draft" | "queued" | "processing" | "rendering" | "completed" | "failed" | "cancelled";

export interface AspectSpec {
  id: "16:9" | "9:16" | "1:1";
  label: string;
  platform: string;
  width: number;
  height: number;
  /* fraction of frame reserved from each edge for platform UI /
     captions — dialogue is kept out of these bands */
  safe: { top: number; bottom: number; left: number; right: number };
}

export const ASPECTS: Record<AspectSpec["id"], AspectSpec> = {
  "16:9": {
    id: "16:9", label: "1920×1080", platform: "YouTube / web",
    width: 1920, height: 1080,
    safe: { top: 0.06, bottom: 0.08, left: 0.05, right: 0.05 },
  },
  "9:16": {
    id: "9:16", label: "1080×1920", platform: "TikTok / Shorts / Reels",
    width: 1080, height: 1920,
    // bottom band is large: caption stack + platform action rail
    safe: { top: 0.12, bottom: 0.22, left: 0.08, right: 0.16 },
  },
  "1:1": {
    id: "1:1", label: "1080×1080", platform: "Instagram feed",
    width: 1080, height: 1080,
    safe: { top: 0.08, bottom: 0.12, left: 0.07, right: 0.07 },
  },
};

export interface MotionProject {
  id: string;
  comic_project_id: string;
  title: string;
  aspect_ratio: AspectSpec["id"];
  fps: number;
  timeline: MotionTimeline | null;
  audio: {
    voice_gain: number;
    sfx_gain: number;
    music_gain: number;
    music_enabled: boolean;
    music_track: string | null;
    duck_sfx_under_voice: boolean;
  };
  render_status: RenderStatus;
  video_url: string | null;
  created_at: string;
  updated_at: string;
}

export type ExportFormat = "mp4" | "webm" | "gif" | "carousel";

