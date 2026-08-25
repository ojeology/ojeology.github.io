/* ============================================================
   BRYME — NON-DESTRUCTIVE SCENE DOCUMENT

   CORE RULE: nothing is baked until export. A scene is structured
   project data, never a pre-rendered clip. Each layer is an
   independent, addressable, editable object:

     Scene
     ├── image      (with revision history + revert)
     ├── characters (Sports Bible references)
     ├── dialogue   (text, timing, emotion)
     ├── voice      (ai | upload | record — swappable)
     ├── bubbles    (geometry, style, font, colour, animation)
     ├── sfx        (instances with gain + timing)
     ├── music
     ├── camera
     ├── transition
     └── timing     (derived from real audio durations)

   deriveTimeline() projects the document into the render timeline
   the existing engine already understands. The document is the
   source of truth; the timeline (and the MP4) are outputs.
   ============================================================ */

import type { EventType } from "../core";
import {
  type BubbleAnim, type BubbleStyle, type CameraMove, type CameraTrack,
  type DialogueKindX, type MotionTimeline, type Scene, type SfxId,
  type TimelineElement, type TransitionKind, type AspectSpec,
} from "./types";
import { buildCamera, cameraMoveFor, placeBubble, transitionFor, LEAD_IN, LINE_GAP, HOLD_AFTER, TAIL, MIN_SCENE } from "./timeline";

/* -------------------------------------------------- layers ---- */

export type ImageSource = "generated" | "uploaded" | "ai_edited" | "seed";

export interface ImageRevision {
  id: string;
  url: string;
  source: ImageSource;
  provider: string;
  prompt?: string;
  note: string;
  created_at: string;
}

export interface ImageLayer {
  current: ImageRevision;
  history: ImageRevision[];        // newest first; revert pops from here
  locked: boolean;
}

export interface CharacterSlot {
  character_id: string;            // Sports Bible stable id
  role_in_scene: string;
  focus: boolean;                  // camera focus target
}

export interface DialogueLayerLine {
  id: string;
  order: number;
  speaker_label: string;
  character_id: string | null;
  text: string;                    // VERBATIM — never auto-translated
  language_label: string;
  kind: DialogueKindX;
  emotion: string;
  /* timing: auto unless pinned */
  start_override: number | null;
  bubble_id: string;
  voice_id: string;
}

export type VoiceSource = "ai" | "upload" | "record" | "silent";

export interface VoiceAsset {
  id: string;
  dialogue_id: string;
  source: VoiceSource;
  provider: string;                // tts adapter id, or "user"
  voice_profile_id: string | null;
  url: string | null;              // blob/object URL for user audio
  duration: number;
  duration_source: "measured" | "estimated";
  gain: number;
  speed: number;
  pitch: number;
  offset: number;                  // nudge relative to its slot
  cache_key: string | null;
  label: string;
  created_at: string;
}

export interface BubbleLayer {
  id: string;
  dialogue_id: string;
  style: BubbleStyle;
  x: number;                       // normalized 0..1
  y: number;
  width: number;                   // 0.15..0.9 of frame width
  font_scale: number;              // 0.6..1.8
  font_family: "display" | "mono" | "comic";
  fill: string;
  text_color: string;
  stroke: string;
  anim_in: BubbleAnim;
  anim_out: "fade_out" | "pop_out";
  lead: number;                    // appears this early vs its audio
  hold: number;                    // lingers this long after audio
  auto_placed: boolean;            // false once the user drags it
  visible: boolean;
}

export interface SfxInstance {
  id: string;
  sfx: SfxId;
  start: number;
  duration: number;
  gain: number;
  label: string;
  locked: boolean;
}

export interface MusicLayer {
  enabled: boolean;
  label: string;
  url: string | null;
  gain: number;
  fade_in: number;
  fade_out: number;
  start: number;
}

export interface CameraLayer {
  move: CameraMove;
  intensity: number;               // 0.5..1.4 multiplier on the move
  focus_character_id: string | null;
  focus_point: { x: number; y: number } | null;
  shake_enabled: boolean;
  auto: boolean;                   // still following the match event?
}

export interface TransitionLayer {
  kind: TransitionKind;
  duration: number;
  auto: boolean;
}

export interface SceneDocument {
  id: string;
  panel_id: string;
  panel_number: number;
  title: string;
  event_type?: EventType;
  image: ImageLayer;
  characters: CharacterSlot[];
  dialogue: DialogueLayerLine[];
  voices: Record<string, VoiceAsset>;   // by dialogue id
  bubbles: BubbleLayer[];
  sfx: SfxInstance[];
  music: MusicLayer;
  camera: CameraLayer;
  transition: TransitionLayer;
  tail: number;
  revision: number;
  updated_at: string;
}

export interface ProjectDocument {
  id: string;
  comic_project_id: string;
  title: string;
  aspect_ratio: AspectSpec["id"];
  fps: number;
  scenes: SceneDocument[];
  mix: { voice: number; sfx: number; music: number };
  revision: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------ mutation ledger ----
   Every edit declares what it touched and what it deliberately left
   alone. This is what makes "non-destructive" verifiable rather than
   a claim in a README.
--------------------------------------------------------------- */

export const ALL_LAYERS = [
  "image", "characters", "dialogue", "voice", "bubbles", "sfx", "music", "camera", "transition", "timing",
] as const;
export type LayerName = (typeof ALL_LAYERS)[number];

export interface Mutation {
  id: string;
  t: string;
  op: string;
  scene_id: string;
  target?: string;
  touched: LayerName[];
  preserved: LayerName[];
  cost: "free" | "voice" | "image" | "image+voice";
  note?: string;
}

export function mutation(
  op: string,
  scene_id: string,
  touched: LayerName[],
  cost: Mutation["cost"] = "free",
  target?: string,
  note?: string
): Mutation {
  return {
    id: `mut_${Math.random().toString(16).slice(2, 8)}`,
    t: new Date().toLocaleTimeString(),
    op,
    scene_id,
    target,
    touched,
    preserved: ALL_LAYERS.filter((l) => !touched.includes(l)),
    cost,
    note,
  };
}

/* ---------------------------------------------- factories ---- */

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 9)}`;

export const BUBBLE_PRESETS: Record<BubbleStyle, { fill: string; text: string; stroke: string }> = {
  speech:      { fill: "#F7F5EF", text: "#12140F", stroke: "#12140F" },
  shout:       { fill: "#FFE9C7", text: "#20150A", stroke: "#20150A" },
  whisper:     { fill: "#EEF2EA", text: "#2A2F27", stroke: "#6C7268" },
  thought:     { fill: "#EFF3FA", text: "#171B22", stroke: "#3B4250" },
  commentator: { fill: "#101410", text: "#F2F6EE", stroke: "#3DD68C" },
  narration:   { fill: "#14120C", text: "#F5EEDC", stroke: "#E8C15A" },
  crowd:       { fill: "#0C100C", text: "#EAF6E8", stroke: "#6CB4EE" },
};

export function makeBubble(dialogueId: string, style: BubbleStyle, x: number, y: number, anim: BubbleAnim): BubbleLayer {
  const p = BUBBLE_PRESETS[style];
  return {
    id: uid("bub"),
    dialogue_id: dialogueId,
    style,
    x, y,
    width: style === "narration" || style === "crowd" || style === "commentator" ? 0.62 : 0.38,
    font_scale: 1,
    font_family: "display",
    fill: p.fill,
    text_color: p.text,
    stroke: p.stroke,
    anim_in: anim,
    anim_out: style === "shout" ? "pop_out" : "fade_out",
    lead: 0.12,
    hold: HOLD_AFTER,
    auto_placed: true,
    visible: true,
  };
}

export function makeSilentVoice(dialogueId: string, duration: number): VoiceAsset {
  return {
    id: uid("vox"),
    dialogue_id: dialogueId,
    source: "silent",
    provider: "none",
    voice_profile_id: null,
    url: null,
    duration,
    duration_source: "estimated",
    gain: 1,
    speed: 1,
    pitch: 1,
    offset: 0,
    cache_key: null,
    label: "no audio yet",
    created_at: now(),
  };
}

export function makeImageRevision(url: string, source: ImageSource, provider: string, note: string, prompt?: string): ImageRevision {
  return { id: uid("img"), url, source, provider, prompt, note, created_at: now() };
}

/* ------------------------------------------------- timing ----
   Timing is DERIVED, never stored as baked numbers. Change one
   voice and everything downstream re-flows automatically.
--------------------------------------------------------------- */

export interface SlotTiming {
  dialogue_id: string;
  audio_start: number;
  audio_end: number;
  bubble_start: number;
  bubble_end: number;
}

export function computeTiming(doc: SceneDocument): { slots: SlotTiming[]; duration: number } {
  const slots: SlotTiming[] = [];
  let cursor = LEAD_IN;

  for (const line of [...doc.dialogue].sort((a, b) => a.order - b.order)) {
    const voice = doc.voices[line.id];
    const bubble = doc.bubbles.find((b) => b.id === line.bubble_id);
    const dur = Math.max(0.3, (voice?.duration ?? 1.2) / Math.max(0.5, voice?.speed ?? 1));
    const start = line.start_override != null ? line.start_override : cursor;
    const withOffset = Math.max(0, start + (voice?.offset ?? 0));
    const end = withOffset + dur;

    slots.push({
      dialogue_id: line.id,
      audio_start: +withOffset.toFixed(3),
      audio_end: +end.toFixed(3),
      bubble_start: +Math.max(0, withOffset - (bubble?.lead ?? 0.12)).toFixed(3),
      bubble_end: +(end + (bubble?.hold ?? HOLD_AFTER)).toFixed(3),
    });
    cursor = end + (bubble?.hold ?? HOLD_AFTER) + LINE_GAP;
  }

  const sfxEnd = doc.sfx.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  const duration = +Math.max(MIN_SCENE, cursor + doc.tail, sfxEnd).toFixed(3);
  return { slots, duration };
}

/* -------------------------------------- document → timeline ----
   A pure projection. The document is never mutated here.
--------------------------------------------------------------- */

export function deriveScene(doc: SceneDocument): Scene {
  const { slots, duration } = computeTiming(doc);
  const elements: TimelineElement[] = [];
  const warnings: string[] = [];

  elements.push({
    id: `${doc.id}-image`,
    type: "image",
    start: 0,
    end: duration,
    source: doc.image.current.url,
  });

  for (const line of doc.dialogue) {
    const slot = slots.find((s) => s.dialogue_id === line.id);
    if (!slot) continue;
    const bubble = doc.bubbles.find((b) => b.id === line.bubble_id);
    const voice = doc.voices[line.id];

    if (bubble && bubble.visible) {
      elements.push({
        id: bubble.id,
        type: "speech_bubble",
        start: slot.bubble_start,
        end: slot.bubble_end,
        speaker: line.speaker_label,
        text: line.text,
        bubble_style: bubble.style,
        anim_in: bubble.anim_in,
        anim_out: bubble.anim_out,
        anchor: { x: bubble.x, y: bubble.y },
        dialogue_id: line.id,
      });
    }
    if (voice && voice.source !== "silent") {
      elements.push({
        id: voice.id,
        type: "audio",
        start: slot.audio_start,
        end: slot.audio_end,
        dialogue_id: line.id,
        speaker: line.speaker_label,
        source: voice.url ?? `audio/${line.id}.wav`,
        gain: voice.gain,
      });
    } else if (voice?.source === "silent") {
      warnings.push(`"${line.speaker_label}" has no audio yet — timing is estimated from the text.`);
    }
  }

  const focus = resolveFocus(doc);
  const track = scaleCamera(
    buildCamera(doc.camera.move, duration, focus, doc.camera.shake_enabled ? doc.event_type : undefined),
    doc.camera.intensity
  );
  elements.push({ id: `${doc.id}-camera`, type: "camera", start: 0, end: duration, camera: track });

  for (const s of doc.sfx) {
    elements.push({
      id: s.id,
      type: "sfx",
      start: s.start,
      end: Math.min(duration, s.start + s.duration),
      sfx: s.sfx,
      gain: s.gain,
    });
  }

  if (doc.music.enabled) {
    elements.push({
      id: `${doc.id}-music`,
      type: "music",
      start: doc.music.start,
      end: duration,
      gain: doc.music.gain,
      source: doc.music.url ?? undefined,
    });
  }

  elements.push({
    id: `${doc.id}-transition`,
    type: "transition",
    start: Math.max(0, duration - doc.transition.duration),
    end: duration,
    transition: doc.transition.kind,
  });

  if (!doc.image.current.url) warnings.push("Scene has no image asset.");

  return {
    id: doc.id,
    panel_id: doc.panel_id,
    panel_number: doc.panel_number,
    title: doc.title,
    image_url: doc.image.current.url,
    event_type: doc.event_type,
    duration,
    offset: 0,
    elements,
    transition_out: doc.transition.kind,
    focus_character: doc.camera.focus_character_id,
    focus_hint: focus,
    warnings,
  };
}

function resolveFocus(doc: SceneDocument): { x: number; y: number } | null {
  if (doc.camera.focus_point) return doc.camera.focus_point;
  return null;
}

function scaleCamera(track: CameraTrack, intensity: number): CameraTrack {
  if (intensity === 1) return track;
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({ ...k, scale: 1 + (k.scale - 1) * intensity })),
    shakes: track.shakes.map((s) => ({ ...s, intensity: s.intensity * intensity })),
  };
}

export function deriveTimeline(project: ProjectDocument): MotionTimeline {
  let offset = 0;
  const scenes = project.scenes.map((doc) => {
    const scene = deriveScene(doc);
    scene.offset = +offset.toFixed(3);
    offset += scene.duration;
    return scene;
  });
  return { scenes, duration: +offset.toFixed(3), fps: project.fps, version: project.revision };
}

/* ------------------------------------------------ helpers ---- */

export function autoAnim(style: BubbleStyle): BubbleAnim {
  const map: Record<BubbleStyle, BubbleAnim> = {
    speech: "pop_in", shout: "shake_in", whisper: "fade_in", thought: "fade_in",
    commentator: "slide_in", narration: "slide_in", crowd: "bounce_in",
  };
  return map[style];
}

export function defaultCamera(event?: EventType, focus?: { x: number; y: number } | null): CameraLayer {
  return {
    move: cameraMoveFor(event),
    intensity: 1,
    focus_character_id: null,
    focus_point: focus ?? null,
    shake_enabled: true,
    auto: true,
  };
}

export function defaultTransition(event?: EventType): TransitionLayer {
  return { kind: transitionFor(event), duration: 0.5, auto: true };
}

export function defaultMusic(): MusicLayer {
  return { enabled: false, label: "none", url: null, gain: 0.22, fade_in: 1.5, fade_out: 2, start: 0 };
}

export { placeBubble, LEAD_IN, LINE_GAP, HOLD_AFTER, TAIL };
export const newId = uid;
export const stamp = now;

