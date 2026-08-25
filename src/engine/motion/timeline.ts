/* ============================================================
   BRYME MOTION — automatic timeline engine
   Panels + dialogue + measured audio durations in → a fully
   choreographed scene out. The user never types a timecode.
   ============================================================ */

import type { EventType, PanelSpec } from "../core";
import {
  ASPECTS,
  type AspectSpec,
  type BubbleAnim,
  type CameraKeyframe,
  type CameraMove,
  type CameraTrack,
  type DialogueLine,
  type MotionTimeline,
  type Scene,
  type SfxId,
  type TimelineElement,
  type TransitionKind,
} from "./types";

/* pacing constants — tuned so scenes breathe like a motion comic,
   not a slideshow */
export const LEAD_IN = 0.45;      // camera settles before anyone speaks
export const LINE_GAP = 0.24;     // beat between speakers
export const HOLD_AFTER = 0.26;   // bubble lingers after audio ends
export const TAIL = 0.70;         // reaction beat before the transition
export const MIN_SCENE = 3.0;
export const BUBBLE_IN = 0.28;
export const BUBBLE_OUT = 0.22;

/* ------------------------------------------------- camera ---- */

/** Reliable focal metadata only. Panels without an entry fall back
    to a safe centre framing — we never guess a character's pixel
    position from the artwork. */
export const FOCUS_HINTS: Record<string, { x: number; y: number }> = {
  "panel-01": { x: 0.5, y: 0.46 },
  "panel-07": { x: 0.44, y: 0.54 },
  "panel-12": { x: 0.52, y: 0.44 },
  "panel-20": { x: 0.43, y: 0.42 },
  "panel-21": { x: 0.5, y: 0.44 },
};

const EVENT_CAMERA: Partial<Record<EventType, CameraMove>> = {
  goal: "zoom_in",
  celebration: "zoom_in",
  save: "focus_character",
  penalty: "zoom_in",
  var: "pan_right",
  argument: "shake",
  kickoff: "zoom_out",
  crowd_reaction: "zoom_in",
  full_time: "zoom_out",
  half_time: "slow_drift",
  yellow_card: "focus_character",
  red_card: "focus_character",
  miss: "zoom_in",
  injury: "slow_drift",
  substitution: "pan_left",
  assist: "pan_right",
};

export function cameraMoveFor(event?: EventType): CameraMove {
  return (event && EVENT_CAMERA[event]) || "slow_drift";
}

/**
 * Build a camera track. Movement stays inside a tight scale band so
 * the artwork never softens or distorts: max 1.18× on a 16:9 source.
 */
export function buildCamera(
  move: CameraMove,
  duration: number,
  focus: { x: number; y: number } | null,
  event?: EventType
): CameraTrack {
  const f = focus ?? { x: 0.5, y: 0.5 };
  const c: CameraKeyframe[] = [];

  const mk = (t: number, scale: number, x: number, y: number) => c.push({ t, scale, x, y });

  switch (move) {
    case "zoom_in":
      mk(0, 1.02, 0.5, 0.5);
      mk(duration, 1.17, f.x, f.y);
      break;
    case "zoom_out":
      mk(0, 1.18, f.x, f.y);
      mk(duration, 1.02, 0.5, 0.5);
      break;
    case "focus_character":
      mk(0, 1.06, 0.5, 0.5);
      mk(duration * 0.55, 1.15, f.x, f.y);
      mk(duration, 1.13, f.x, f.y);
      break;
    case "pan_left":
      mk(0, 1.1, 0.62, 0.5);
      mk(duration, 1.1, 0.38, 0.5);
      break;
    case "pan_right":
      mk(0, 1.1, 0.38, 0.5);
      mk(duration, 1.1, 0.62, 0.5);
      break;
    case "pan_up":
      mk(0, 1.1, 0.5, 0.62);
      mk(duration, 1.1, 0.5, 0.38);
      break;
    case "pan_down":
      mk(0, 1.1, 0.5, 0.38);
      mk(duration, 1.1, 0.5, 0.62);
      break;
    case "shake":
      mk(0, 1.08, f.x, f.y);
      mk(duration, 1.12, f.x, f.y);
      break;
    case "focus_center":
      mk(0, 1.05, 0.5, 0.5);
      mk(duration, 1.05, 0.5, 0.5);
      break;
    case "slow_drift":
    default:
      mk(0, 1.04, 0.46, 0.5);
      mk(duration, 1.11, 0.54, 0.5);
      break;
  }

  const shakes: CameraTrack["shakes"] = [];
  if (event === "goal") shakes.push({ start: 0.12, end: 0.72, intensity: 1 });
  if (event === "celebration") shakes.push({ start: 0.1, end: 0.5, intensity: 0.6 });
  if (event === "argument" || move === "shake") shakes.push({ start: 0.2, end: Math.min(1.4, duration), intensity: 0.55 });
  if (event === "save") shakes.push({ start: 0.05, end: 0.35, intensity: 0.4 });
  if (event === "red_card") shakes.push({ start: 0, end: 0.4, intensity: 0.5 });

  return { move, keyframes: c, shakes };
}

/** Sample the camera at time t (seconds into the scene). */
export function sampleCamera(track: CameraTrack, t: number): { scale: number; x: number; y: number } {
  const k = track.keyframes;
  if (k.length === 0) return { scale: 1, x: 0.5, y: 0.5 };
  if (t <= k[0].t) return { scale: k[0].scale, x: k[0].x, y: k[0].y };
  const last = k[k.length - 1];
  if (t >= last.t) return { scale: last.scale, x: last.x, y: last.y };

  let i = 0;
  while (i < k.length - 1 && k[i + 1].t < t) i++;
  const a = k[i];
  const b = k[i + 1];
  const span = Math.max(1e-6, b.t - a.t);
  const raw = (t - a.t) / span;
  const e = easeInOutCubic(raw);          // no linear robot moves
  return {
    scale: a.scale + (b.scale - a.scale) * e,
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
  };
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Decaying handheld shake offset in normalized units. */
export function shakeOffset(track: CameraTrack, t: number): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  for (const s of track.shakes) {
    if (t < s.start || t > s.end) continue;
    const life = (t - s.start) / Math.max(1e-6, s.end - s.start);
    const decay = Math.pow(1 - life, 2);
    const amp = 0.012 * s.intensity * decay;
    dx += Math.sin(t * 61) * amp;
    dy += Math.cos(t * 47) * amp * 0.8;
  }
  return { dx, dy };
}

/* ------------------------------------------------ bubbles ---- */

const ANIM_BY_STYLE: Record<string, BubbleAnim> = {
  speech: "pop_in",
  shout: "shake_in",
  whisper: "fade_in",
  thought: "fade_in",
  commentator: "slide_in",
  narration: "slide_in",
  crowd: "bounce_in",
};

export function bubbleAnimFor(style: string): BubbleAnim {
  return ANIM_BY_STYLE[style] ?? "pop_in";
}

/**
 * Auto-placement inside the platform safe area. Bubbles alternate
 * sides so two speakers never stack, and are pushed clear of the
 * focal point so the camera subject stays readable.
 */
export function placeBubble(
  index: number,
  total: number,
  aspect: AspectSpec,
  focus: { x: number; y: number } | null,
  style: string
): { x: number; y: number } {
  const s = aspect.safe;
  const minX = s.left + 0.06;
  const maxX = 1 - s.right - 0.06;
  const minY = s.top + 0.05;
  const maxY = 1 - s.bottom - 0.05;

  if (style === "narration" || style === "commentator") {
    // banner styles ride the top safe line, centred
    return { x: clamp(0.5, minX, maxX), y: clamp(minY + 0.02, minY, maxY) };
  }
  if (style === "crowd") {
    return { x: clamp(0.5, minX, maxX), y: clamp(maxY - 0.02, minY, maxY) };
  }

  const lane = total <= 1 ? 0.5 : index % 2 === 0 ? 0.3 : 0.7;
  let x = clamp(lane, minX, maxX);
  const row = total <= 2 ? 0.26 : 0.22 + (index % 3) * 0.13;
  const y = clamp(row, minY, maxY);

  // nudge away from the camera's focal subject
  if (focus && Math.abs(focus.x - x) < 0.18) {
    x = clamp(focus.x > 0.5 ? minX + 0.1 : maxX - 0.1, minX, maxX);
  }
  return { x, y };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* --------------------------------------------------- sfx ---- */

const EVENT_SFX: Partial<Record<EventType, { sfx: SfxId; at: number }[]>> = {
  goal: [
    { sfx: "kick", at: 0.02 },
    { sfx: "goal_impact", at: 0.14 },
    { sfx: "net_ripple", at: 0.3 },
    { sfx: "crowd_roar", at: 0.18 },
  ],
  celebration: [{ sfx: "crowd_roar", at: 0.05 }, { sfx: "cheer", at: 0.6 }],
  save: [{ sfx: "crowd_gasp", at: 0.06 }, { sfx: "shock_sting", at: 0.02 }],
  penalty: [{ sfx: "whistle", at: 0.05 }, { sfx: "crowd_gasp", at: 0.5 }],
  var: [{ sfx: "boo", at: 0.35 }, { sfx: "camera_hit", at: 0.05 }],
  argument: [{ sfx: "boo", at: 0.2 }],
  kickoff: [{ sfx: "whistle", at: 0.25 }],
  half_time: [{ sfx: "whistle", at: 0.1 }],
  full_time: [{ sfx: "whistle", at: 0.1 }, { sfx: "crowd_roar", at: 0.4 }],
  crowd_reaction: [{ sfx: "cheer", at: 0.05 }, { sfx: "crowd_roar", at: 0.25 }],
  yellow_card: [{ sfx: "boo", at: 0.3 }, { sfx: "camera_hit", at: 0.05 }],
  red_card: [{ sfx: "shock_sting", at: 0.05 }, { sfx: "boo", at: 0.4 }],
  miss: [{ sfx: "crowd_gasp", at: 0.1 }],
  injury: [{ sfx: "crowd_gasp", at: 0.15 }],
};

const EVENT_TRANSITION: Partial<Record<EventType, TransitionKind>> = {
  goal: "flash",
  celebration: "whip_pan",
  save: "whip_pan",
  var: "dip_to_black",
  argument: "whip_pan",
  kickoff: "crossfade",
  full_time: "dip_to_black",
  crowd_reaction: "crossfade",
};

export function transitionFor(event?: EventType): TransitionKind {
  return (event && EVENT_TRANSITION[event]) || "crossfade";
}

/* --------------------------------------------- scene build ---- */

export interface BuildOptions {
  aspect: AspectSpec;
  sfxEnabled: boolean;
  ambienceEnabled: boolean;
}

export function buildScene(
  panel: PanelSpec,
  lines: DialogueLine[],
  durations: Record<string, number>,
  opts: BuildOptions
): Scene {
  const warnings: string[] = [];
  const focus = FOCUS_HINTS[panel.id] ?? null;
  if (!focus) warnings.push("No focal metadata for this panel — camera falls back to a safe centre framing.");
  if (!panel.image_url) warnings.push("Panel has no rendered artwork yet — generate it in the image engine first.");

  const ordered = [...lines].sort((a, b) => a.order - b.order);
  const elements: TimelineElement[] = [];

  // 1. dialogue + bubbles drive the clock
  let cursor = LEAD_IN;
  ordered.forEach((line, i) => {
    const dur = durations[line.id] ?? 1.4;
    const start = cursor;
    const audioEnd = start + dur;
    const bubbleEnd = audioEnd + HOLD_AFTER;

    elements.push({
      id: `${line.id}-bubble`,
      type: "speech_bubble",
      start: Math.max(0, start - 0.12),        // bubble lands just before the voice
      end: bubbleEnd,
      speaker: line.speaker_label,
      text: line.text,                          // verbatim
      bubble_style: line.bubble_style,
      anim_in: bubbleAnimFor(line.bubble_style),
      anim_out: line.bubble_style === "shout" ? "pop_out" : "fade_out",
      anchor: line.anchor ?? placeBubble(i, ordered.length, opts.aspect, focus, line.bubble_style),
      dialogue_id: line.id,
    });
    elements.push({
      id: `${line.id}-audio`,
      type: "audio",
      start,
      end: audioEnd,
      dialogue_id: line.id,
      speaker: line.speaker_label,
      source: `audio/${line.id}.wav`,
      gain: 1,
    });

    cursor = bubbleEnd + LINE_GAP;
  });

  const duration = +Math.max(MIN_SCENE, cursor + TAIL).toFixed(3);

  // 2. the image bed
  elements.unshift({
    id: `${panel.id}-image`,
    type: "image",
    start: 0,
    end: duration,
    source: panel.image_url ?? undefined,
  });

  // 3. camera choreography
  const move = cameraMoveFor(panel.event?.type);
  elements.push({
    id: `${panel.id}-camera`,
    type: "camera",
    start: 0,
    end: duration,
    camera: buildCamera(move, duration, focus, panel.event?.type),
  });

  // 4. sound design, layered beneath the voice
  if (opts.sfxEnabled) {
    const hits = EVENT_SFX[panel.event?.type as EventType] ?? [];
    for (const h of hits) {
      elements.push({
        id: `${panel.id}-sfx-${h.sfx}-${h.at}`,
        type: "sfx",
        start: h.at,
        end: Math.min(duration, h.at + 2.4),
        sfx: h.sfx,
        gain: 1,
      });
    }
  }
  if (opts.ambienceEnabled) {
    elements.push({
      id: `${panel.id}-ambience`,
      type: "sfx",
      start: 0,
      end: duration,
      sfx: "crowd_ambience",
      gain: 1,
    });
  }

  // 5. outgoing transition
  const transition = transitionFor(panel.event?.type);
  elements.push({
    id: `${panel.id}-transition`,
    type: "transition",
    start: Math.max(0, duration - 0.5),
    end: duration,
    transition,
  });

  return {
    id: panel.id,
    panel_id: panel.id,
    panel_number: panel.number,
    title: panel.title,
    image_url: panel.image_url ?? null,
    event_type: panel.event?.type,
    duration,
    offset: 0,
    elements,
    transition_out: transition,
    focus_character: panel.character_ids[0] ?? null,
    focus_hint: focus,
    warnings,
  };
}

/** Re-stack scene offsets into one continuous film. */
export function sequence(scenes: Scene[], fps = 30): MotionTimeline {
  let offset = 0;
  const stacked = scenes.map((s) => {
    const withOffset = { ...s, offset: +offset.toFixed(3) };
    offset += s.duration;
    return withOffset;
  });
  return { scenes: stacked, duration: +offset.toFixed(3), fps, version: 1 };
}

export function sceneAt(timeline: MotionTimeline, t: number): { scene: Scene; local: number } | null {
  for (const s of timeline.scenes) {
    if (t >= s.offset && t < s.offset + s.duration) return { scene: s, local: t - s.offset };
  }
  const last = timeline.scenes[timeline.scenes.length - 1];
  return last ? { scene: last, local: last.duration } : null;
}

export const DEFAULT_ASPECT = ASPECTS["16:9"];

