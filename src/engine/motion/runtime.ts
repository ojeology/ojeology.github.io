/* ============================================================
   BRYME MOTION — service layer / store
   Mirrors app/motion/motion_service.py: auto-build, voice
   generation, modular regeneration, render jobs.
   ============================================================ */

import { useSyncExternalStore } from "react";
import { PROJECT, engine as imageEngine } from "../runtime";
import type { PanelSpec } from "../core";
import {
  ASPECTS,
  type AspectSpec,
  type AudioAsset,
  type BubbleStyle,
  type CameraMove,
  type DialogueKindX,
  type DialogueLine,
  type ExportFormat,
  type MotionProject,
  type MotionTimeline,
  type RenderStatus,
  type Scene,
  type TTSProviderId,
} from "./types";
import { AudioCache, TTS_PROVIDERS, estimateDuration, resolveVoice, synthesize, voiceProfile } from "./tts";
import { buildCamera, buildScene, placeBubble, sequence, FOCUS_HINTS } from "./timeline";

/* ------------------------------------------- dialogue import ---- */

const KIND_MAP: Record<string, DialogueKindX> = {
  speech: "speech",
  narration: "narration",
  caption: "narration",
  commentary: "commentary",
  crowd: "crowd",
};

const STYLE_MAP: Record<DialogueKindX, BubbleStyle> = {
  speech: "speech",
  narration: "narration",
  commentary: "commentator",
  crowd: "crowd",
  shout: "shout",
  whisper: "whisper",
  sound_effect: "speech",
};

const EMOTION_BY_EVENT: Record<string, string> = {
  goal: "excited", celebration: "excited", save: "defiant", var: "mocking",
  argument: "angry", kickoff: "calm", crowd_reaction: "roaring", full_time: "excited",
};

/** Lift the panel's authored dialogue into motion dialogue lines. */
export function importDialogue(panel: PanelSpec): DialogueLine[] {
  return panel.dialogue.map((d, i) => {
    let kind = KIND_MAP[d.kind] ?? "speech";
    // an all-caps exclamation is a shout, not a conversational line
    if (kind === "speech" && /[A-Z]{3,}/.test(d.text) && d.text.includes("!")) kind = "shout";
    const voice = resolveVoice(d.speaker);
    const emotion =
      kind === "shout" ? "excited"
      : kind === "crowd" ? "roaring"
      : EMOTION_BY_EVENT[panel.event?.type ?? ""] ?? voice.default_emotion;

    return {
      id: `${panel.id}-l${i + 1}`,
      panel_id: panel.id,
      order: i + 1,
      speaker_label: d.speaker,
      character_id: voice.character_id,
      voice_profile_id: voice.id,
      text: d.text,                                 // VERBATIM
      language_label: d.language ?? voice.language_label,
      kind,
      bubble_style: STYLE_MAP[kind],
      emotion,
      priority: i + 1,
    } satisfies DialogueLine;
  });
}

/* -------------------------------------------------- state ---- */

export type BuildPhase =
  | "idle" | "import_panels" | "resolve_voices" | "synthesize"
  | "measure" | "timeline" | "bubbles" | "camera" | "transitions" | "sfx" | "save" | "ready";

export interface BuildLogEntry {
  t: string;
  phase: BuildPhase;
  msg: string;
  tone: "info" | "ok" | "warn" | "err";
}

export interface RenderJob {
  id: string;
  motion_project_id: string;
  format: ExportFormat;
  aspect: AspectSpec["id"];
  status: RenderStatus;
  progress: number;
  current_panel: number;
  total_panels: number;
  video_url: string | null;
  size_bytes: number | null;
  error: { code: string; message: string; retryable: boolean } | null;
  created_at: string;
  completed_at: string | null;
}

interface MotionState {
  project: MotionProject;
  lines: DialogueLine[];
  assets: Record<string, AudioAsset>;     // by dialogue id
  durations: Record<string, number>;
  buildPhase: BuildPhase;
  buildProgress: number;
  log: BuildLogEntry[];
  renders: RenderJob[];
  ttsProvider: TTSProviderId;
  sfxEnabled: boolean;
  ambienceEnabled: boolean;
  stats: { cache_hits: number; synthesized: number; characters: number; regenerations: number };
}

const NOW = () => new Date().toISOString();

function initialProject(): MotionProject {
  return {
    id: "mc_citybou_01",
    comic_project_id: PROJECT.id,
    title: `${PROJECT.name} — Motion Comic`,
    aspect_ratio: "16:9",
    fps: 30,
    timeline: null,
    audio: {
      voice_gain: 1,
      sfx_gain: 0.85,
      music_gain: 0.25,
      music_enabled: false,
      music_track: null,
      duck_sfx_under_voice: true,
    },
    render_status: "draft",
    video_url: null,
    created_at: NOW(),
    updated_at: NOW(),
  };
}

class MotionRuntime {
  private state: MotionState;
  private listeners = new Set<() => void>();
  private cache = new AudioCache();

  constructor() {
    const lines = PROJECT.panels.flatMap(importDialogue);
    this.state = {
      project: initialProject(),
      lines,
      assets: {},
      durations: {},
      buildPhase: "idle",
      buildProgress: 0,
      log: [],
      renders: [],
      ttsProvider: "browser",
      sfxEnabled: true,
      ambienceEnabled: true,
      stats: { cache_hits: 0, synthesized: 0, characters: 0, regenerations: 0 },
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<MotionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }
  private log(phase: BuildPhase, msg: string, tone: BuildLogEntry["tone"] = "info") {
    const entry: BuildLogEntry = { t: new Date().toLocaleTimeString(), phase, msg, tone };
    this.set({ log: [...this.state.log.slice(-160), entry] });
  }

  /* ------------------------------------------- configuration ---- */

  setProvider(id: TTSProviderId) {
    this.set({ ttsProvider: id });
  }
  setSfx(enabled: boolean) {
    this.set({ sfxEnabled: enabled });
    if (this.state.project.timeline) this.rebuildTimeline("sfx toggled");
  }
  setAmbience(enabled: boolean) {
    this.set({ ambienceEnabled: enabled });
    if (this.state.project.timeline) this.rebuildTimeline("ambience toggled");
  }
  setAudioMix(patch: Partial<MotionProject["audio"]>) {
    this.set({ project: { ...this.state.project, audio: { ...this.state.project.audio, ...patch }, updated_at: NOW() } });
  }

  /** Aspect change re-places bubbles for the new safe zones only —
      no image and no voice is regenerated. */
  setAspect(id: AspectSpec["id"]) {
    this.set({ project: { ...this.state.project, aspect_ratio: id, updated_at: NOW() } });
    if (this.state.project.timeline) {
      this.rebuildTimeline(`aspect → ${id} (bubbles re-placed for safe zones; 0 voices regenerated)`);
    }
  }

  /* ------------------------------------------------ auto-build ---
     POST /api/v1/motion-comics/{id}/auto-build
  --------------------------------------------------------------- */

  async autoBuild(): Promise<void> {
    const panels = PROJECT.panels;
    this.set({ buildPhase: "import_panels", buildProgress: 0, log: [] });
    this.log("import_panels", `importing ${panels.length} panels from comic project ${PROJECT.id}`, "info");
    await wait(280);

    // artwork check — reuse the existing image engine, never duplicate it
    const missing = panels.filter((p) => !imageEngine.getState().panels[p.id]?.image_url);
    if (missing.length) {
      this.log("import_panels", `${missing.length} panel(s) lack artwork — dispatching to the image engine`, "warn");
      for (const p of missing) {
        imageEngine.generate(p.id, "sandbox");
        this.log("import_panels", `queued image generation for ${p.id}`, "info");
      }
      await this.awaitArtwork(missing.map((p) => p.id));
    }
    this.log("import_panels", "all panels have rendered artwork", "ok");
    this.set({ buildProgress: 10 });

    // voices
    this.set({ buildPhase: "resolve_voices" });
    const lines = this.state.lines;
    const profiles = new Set(lines.map((l) => l.voice_profile_id));
    this.log("resolve_voices", `${lines.length} dialogue lines → ${profiles.size} voice profiles`, "info");
    const pidgin = lines.filter((l) => /pidgin/i.test(l.language_label)).length;
    this.log("resolve_voices", `${pidgin} lines flagged Nigerian Pidgin — text preserved verbatim, no translation`, "ok");
    await wait(320);
    this.set({ buildProgress: 20 });

    // synthesis
    this.set({ buildPhase: "synthesize" });
    const provider = TTS_PROVIDERS[this.state.ttsProvider];
    if (!provider.capabilities.configured) {
      this.log("synthesize", `${provider.label} is not configured in this environment`, "err");
      this.set({ buildPhase: "idle" });
      throw new Error(`TTS provider "${provider.id}" is not configured.`);
    }
    if (!provider.capabilities.native_pidgin_locale) {
      this.log("synthesize", `${provider.label}: no native Pidgin locale — using closest accent, text unchanged`, "warn");
    }

    const durations: Record<string, number> = { ...this.state.durations };
    const assets: Record<string, AudioAsset> = { ...this.state.assets };
    let hits = 0;
    let made = 0;
    let chars = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const { asset, cached } = await synthesize(line, this.state.ttsProvider, this.cache);
      assets[line.id] = asset;
      durations[line.id] = asset.duration;
      if (cached) hits++;
      else {
        made++;
        chars += line.text.length;
      }
      this.set({
        assets,
        durations,
        buildProgress: 20 + Math.round(((i + 1) / lines.length) * 45),
      });
      if (i % 2 === 0) await wait(90);
    }
    this.log("synthesize", `${made} lines synthesized, ${hits} served from cache (${chars} chars billed)`, "ok");

    this.set({ buildPhase: "measure" });
    this.log("measure", `durations resolved — ${provider.capabilities.exact_duration ? "exact from audio file" : "estimated, reconciled on playback"}`, provider.capabilities.exact_duration ? "ok" : "warn");
    await wait(240);
    this.set({ buildProgress: 70 });

    // timeline assembly
    for (const [phase, msg] of [
      ["timeline", "laying dialogue onto the clock"],
      ["bubbles", "auto-placing speech bubbles inside platform safe zones"],
      ["camera", "choreographing camera from match events"],
      ["transitions", "selecting scene transitions"],
      ["sfx", "layering sound design beneath the voice bed"],
    ] as [BuildPhase, string][]) {
      this.set({ buildPhase: phase });
      this.log(phase, msg, "info");
      await wait(200);
      this.set({ buildProgress: this.state.buildProgress + 5 });
    }

    const timeline = this.composeTimeline(durations);
    this.set({ buildPhase: "save" });
    await wait(180);

    this.set({
      project: { ...this.state.project, timeline, render_status: "draft", updated_at: NOW() },
      buildPhase: "ready",
      buildProgress: 100,
      stats: {
        cache_hits: this.state.stats.cache_hits + hits,
        synthesized: this.state.stats.synthesized + made,
        characters: this.state.stats.characters + chars,
        regenerations: this.state.stats.regenerations,
      },
    });
    this.log("save", `motion project ready — ${timeline.scenes.length} scenes, ${timeline.duration.toFixed(1)}s total`, "ok");
  }

  private async awaitArtwork(panelIds: string[]) {
    return new Promise<void>((resolve) => {
      const check = () => {
        const st = imageEngine.getState();
        const done = panelIds.every((id) => st.panels[id]?.image_url);
        if (done) {
          unsub();
          resolve();
        }
      };
      const unsub = imageEngine.subscribe(check);
      check();
    });
  }

  private composeTimeline(durations: Record<string, number>): MotionTimeline {
    const aspect = ASPECTS[this.state.project.aspect_ratio];
    const scenes: Scene[] = PROJECT.panels.map((p) => {
      const panel = imageEngine.getState().panels[p.id] ?? p;
      const lines = this.state.lines.filter((l) => l.panel_id === p.id);
      return buildScene(panel, lines, durations, {
        aspect,
        sfxEnabled: this.state.sfxEnabled,
        ambienceEnabled: this.state.ambienceEnabled,
      });
    });
    return sequence(scenes, this.state.project.fps);
  }

  private rebuildTimeline(reason: string) {
    const timeline = this.composeTimeline(this.state.durations);
    this.set({ project: { ...this.state.project, timeline, updated_at: NOW() } });
    this.log("timeline", `timeline rebuilt — ${reason}`, "ok");
  }

  /* ----------------------------------------------- modularity ---
     Cost control: each of these touches exactly one asset class.
  --------------------------------------------------------------- */

  /** Voice only — image untouched, timeline re-timed. */
  async regenerateVoice(dialogueId: string, patch?: { speed?: number; pitch?: number; emotion?: string; voice_profile_id?: string }) {
    const idx = this.state.lines.findIndex((l) => l.id === dialogueId);
    if (idx < 0) return;
    const line = { ...this.state.lines[idx] };
    if (patch?.speed !== undefined) line.speed_override = patch.speed;
    if (patch?.pitch !== undefined) line.pitch_override = patch.pitch;
    if (patch?.emotion) line.emotion = patch.emotion;
    if (patch?.voice_profile_id) {
      line.voice_profile_id = patch.voice_profile_id;
      line.character_id = voiceProfile(patch.voice_profile_id).character_id;
    }
    const lines = [...this.state.lines];
    lines[idx] = line;
    this.cache.invalidate(dialogueId);
    this.set({ lines });

    const { asset } = await synthesize(line, this.state.ttsProvider, this.cache);
    this.set({
      assets: { ...this.state.assets, [line.id]: asset },
      durations: { ...this.state.durations, [line.id]: asset.duration },
      stats: { ...this.state.stats, regenerations: this.state.stats.regenerations + 1, synthesized: this.state.stats.synthesized + 1 },
    });
    this.rebuildTimeline(`voice regenerated for ${dialogueId} — image untouched`);
  }

  /** Bubble only — no image, no audio. */
  updateBubble(dialogueId: string, patch: { text?: string; bubble_style?: BubbleStyle; anchor?: { x: number; y: number } }) {
    const idx = this.state.lines.findIndex((l) => l.id === dialogueId);
    if (idx < 0) return;
    const lines = [...this.state.lines];
    const next = { ...lines[idx], ...patch };
    const textChanged = patch.text !== undefined && patch.text !== lines[idx].text;
    lines[idx] = next;
    this.set({ lines });

    if (textChanged) {
      // text drives audio, so the old take is stale — flag, don't silently bill
      this.log("bubbles", `text changed on ${dialogueId} — voice is now stale, regenerate to re-sync`, "warn");
      const est = estimateDuration(next.text, next.speed_override ?? voiceProfile(next.voice_profile_id).speed, next.emotion);
      this.set({ durations: { ...this.state.durations, [dialogueId]: est } });
    }
    this.rebuildTimeline(
      `bubble updated on ${dialogueId} — 0 images, 0 voices regenerated${textChanged ? " (audio flagged stale)" : ""}`
    );
  }

  /** Camera only — no image, no audio. */
  updateCamera(sceneId: string, move: CameraMove) {
    const tl = this.state.project.timeline;
    if (!tl) return;
    const scenes = tl.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      const focus = s.focus_hint ?? FOCUS_HINTS[s.panel_id] ?? null;
      const elements = s.elements.map((el) =>
        el.type === "camera" ? { ...el, camera: buildCamera(move, s.duration, focus, s.event_type) } : el
      );
      return { ...s, elements };
    });
    this.set({ project: { ...this.state.project, timeline: { ...tl, scenes }, updated_at: NOW() } });
    this.log("camera", `camera → ${move} on ${sceneId} — 0 images, 0 voices regenerated`, "ok");
  }

  /** Whole scene — artwork + voice + timeline. The expensive one. */
  async regenerateScene(panelId: string) {
    this.log("timeline", `full scene regeneration for ${panelId} — image + voice + timeline`, "warn");
    imageEngine.generate(panelId, "sandbox");
    await this.awaitArtwork([panelId]);
    const lines = this.state.lines.filter((l) => l.panel_id === panelId);
    for (const l of lines) {
      this.cache.invalidate(l.id);
      const { asset } = await synthesize(l, this.state.ttsProvider, this.cache);
      this.set({
        assets: { ...this.state.assets, [l.id]: asset },
        durations: { ...this.state.durations, [l.id]: asset.duration },
      });
    }
    this.rebuildTimeline(`scene ${panelId} fully regenerated`);
  }

  /** Reconcile the estimate with what the voice engine actually took. */
  reportMeasuredDuration(dialogueId: string, measured: number) {
    if (measured < 0.25) return;
    const asset = this.state.assets[dialogueId];
    const prev = this.state.durations[dialogueId];
    if (prev && Math.abs(prev - measured) < 0.16) return;   // already close enough
    this.set({
      durations: { ...this.state.durations, [dialogueId]: +measured.toFixed(3) },
      assets: asset
        ? { ...this.state.assets, [dialogueId]: { ...asset, duration: +measured.toFixed(3), duration_source: "measured" } }
        : this.state.assets,
    });
  }

  resyncTimeline() {
    this.rebuildTimeline("re-synced against measured playback durations");
  }

  /* -------------------------------------------- render jobs ---- */

  startRender(format: ExportFormat = "mp4"): RenderJob {
    const job: RenderJob = {
      id: `rnd_${Math.random().toString(16).slice(2, 8)}`,
      motion_project_id: this.state.project.id,
      format,
      aspect: this.state.project.aspect_ratio,
      status: "rendering",
      progress: 0,
      current_panel: 1,
      total_panels: this.state.project.timeline?.scenes.length ?? 0,
      video_url: null,
      size_bytes: null,
      error: null,
      created_at: NOW(),
      completed_at: null,
    };
    this.set({
      renders: [job, ...this.state.renders],
      project: { ...this.state.project, render_status: "rendering" },
    });
    this.log("save", `render job ${job.id} started — ${format.toUpperCase()} ${this.state.project.aspect_ratio}`, "info");
    return job;
  }

  reportRenderProgress(id: string, progress: number, currentPanel: number) {
    this.set({
      renders: this.state.renders.map((r) =>
        r.id === id ? { ...r, progress: Math.min(99, Math.round(progress)), current_panel: currentPanel } : r
      ),
    });
  }

  completeRender(id: string, url: string, bytes: number) {
    this.set({
      renders: this.state.renders.map((r) =>
        r.id === id
          ? { ...r, status: "completed" as RenderStatus, progress: 100, video_url: url, size_bytes: bytes, completed_at: NOW() }
          : r
      ),
      project: { ...this.state.project, render_status: "completed", video_url: url, updated_at: NOW() },
    });
    this.log("save", `render ${id} complete — ${(bytes / 1024 / 1024).toFixed(2)} MB`, "ok");
  }

  failRender(id: string, code: string, message: string) {
    this.set({
      renders: this.state.renders.map((r) =>
        r.id === id ? { ...r, status: "failed" as RenderStatus, error: { code, message, retryable: true }, completed_at: NOW() } : r
      ),
      project: { ...this.state.project, render_status: "failed" },
    });
    this.log("save", `render ${id} failed — ${code}: ${message}`, "err");
  }

  cancelRender(id: string) {
    this.set({
      renders: this.state.renders.map((r) => (r.id === id ? { ...r, status: "cancelled" as RenderStatus, completed_at: NOW() } : r)),
      project: { ...this.state.project, render_status: "cancelled" },
    });
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const motion = new MotionRuntime();

/* ------------------------------------------------- hooks ---- */

export function useMotion(): MotionState {
  return useSyncExternalStore(motion.subscribe, motion.getState);
}

export function useTimeline(): MotionTimeline | null {
  return useSyncExternalStore(motion.subscribe, () => motion.getState().project.timeline);
}

/* helper for views */
export function linesForPanel(state: MotionState, panelId: string): DialogueLine[] {
  return state.lines.filter((l) => l.panel_id === panelId).sort((a, b) => a.order - b.order);
}
export { ASPECTS, placeBubble };

