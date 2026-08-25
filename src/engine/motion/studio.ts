/* ============================================================
   BRYME — STUDIO RUNTIME (non-destructive edit store)

   Mirrors app/editor/scene_service.py. Every mutation is scoped to
   one layer, records what it preserved, and re-derives timing rather
   than baking it. The MP4 is an export target, never the project.
   ============================================================ */

import { useSyncExternalStore } from "react";
import { PROJECT, engine as imageEngine } from "../runtime";
import type { EventType } from "../core";
import {
  ALL_LAYERS, autoAnim, computeTiming, defaultCamera, defaultMusic, defaultTransition,
  deriveScene, deriveTimeline, makeBubble, makeImageRevision, makeSilentVoice, mutation,
  newId, placeBubble, stamp,
  type BubbleLayer, type CameraLayer, type DialogueLayerLine, type ImageRevision,
  type LayerName, type Mutation, type ProjectDocument, type SceneDocument, type SfxInstance,
  type VoiceAsset, type VoiceSource,
} from "./document";
import { FOCUS_HINTS } from "./timeline";
import { ASPECTS, SFX_LIBRARY, type AspectSpec, type BubbleStyle, type CameraMove, type MotionTimeline, type RenderStatus, type SfxId, type TTSProviderId, type TransitionKind } from "./types";
import { TTS_PROVIDERS, cacheKey, estimateDuration, resolveVoice, voiceProfile } from "./tts";
import { fromLegacy, sportsCharacter } from "./sportsbible";
import { IMAGE_EDIT_PROVIDERS, measureAudio, type ImageEditProviderId, type UserAudioResult } from "./editProviders";
import { SEED_PLAYERS, newPlayerId, playerByName, type Player } from "./players";
import { clearFilm, materializeProjectImages, readFilm, writeFilm } from "./persist";
import { speakText, stopSpeech, type SpokenResult } from "./audio";

/* ------------------------------------------------ selection ---- */

export type Selection =
  | { kind: "none" }
  | { kind: "image"; scene: string }
  | { kind: "dialogue"; scene: string; id: string }
  | { kind: "bubble"; scene: string; id: string }
  | { kind: "voice"; scene: string; id: string }
  | { kind: "sfx"; scene: string; id: string }
  | { kind: "camera"; scene: string }
  | { kind: "transition"; scene: string }
  | { kind: "music"; scene: string }
  | { kind: "character"; scene: string; id: string };

export interface ExportJob {
  id: string;
  status: RenderStatus;
  progress: number;
  current_scene: number;
  total_scenes: number;
  url: string | null;
  bytes: number | null;
  mime: string;
  error: string | null;
  created_at: string;
  project_revision_at_export: number;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

interface StudioState {
  project: ProjectDocument;
  timeline: MotionTimeline;
  selection: Selection;
  mutations: Mutation[];
  busy: string | null;
  exports: ExportJob[];
  ttsProvider: TTSProviderId;
  imageProvider: ImageEditProviderId;
  lastError: string | null;
  players: Player[];
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
}

/* --------------------------------------------- seed builder ---- */

const SPEAKER_TO_CHARACTER: Record<string, string> = {
  "City Player": "cty-05-centreback",
  "City Captain": "cty-08-midfielder",
  "City Midfielder": "cty-08-midfielder",
  Keeper: "bou-01-keeper",
  Commentator: "neutral-commentator",
  Narrator: null as unknown as string,
  Crowd: "neutral-crowd",
};

const SPEAKER_TO_PLAYER: Record<string, string> = {
  "City Midfielder": "pl_mid",
  "City Captain": "pl_cap",
  "City Player": "pl_cb",
  Keeper: "pl_gk",
  Commentator: "pl_com",
  Narrator: "pl_nar",
  Crowd: "pl_crd",
};

const SFX_BY_EVENT: Partial<Record<EventType, { sfx: SfxId; at: number }[]>> = {
  goal: [{ sfx: "kick", at: 0.02 }, { sfx: "goal_impact", at: 0.14 }, { sfx: "crowd_roar", at: 0.18 }],
  celebration: [{ sfx: "crowd_roar", at: 0.05 }],
  save: [{ sfx: "shock_sting", at: 0.02 }, { sfx: "crowd_gasp", at: 0.06 }],
  var: [{ sfx: "camera_hit", at: 0.05 }, { sfx: "boo", at: 0.35 }],
  kickoff: [{ sfx: "whistle", at: 0.25 }],
  crowd_reaction: [{ sfx: "cheer", at: 0.05 }, { sfx: "crowd_roar", at: 0.25 }],
};

function buildSceneDocument(panelId: string): SceneDocument {
  const panel = imageEngine.getState().panels[panelId] ?? PROJECT.panels.find((p) => p.id === panelId)!;
  const aspect = ASPECTS["16:9"];
  const focus = FOCUS_HINTS[panelId] ?? null;

  const dialogue: DialogueLayerLine[] = [];
  const bubbles: BubbleLayer[] = [];
  const voices: Record<string, VoiceAsset> = {};

  panel.dialogue.forEach((d, i) => {
    const id = `${panelId}-l${i + 1}`;
    let kind = (d.kind === "caption" ? "narration" : d.kind) as DialogueLayerLine["kind"];
    if (kind === "speech" && /[A-Z]{3,}/.test(d.text) && d.text.includes("!")) kind = "shout";
    const style: BubbleStyle =
      kind === "narration" ? "narration" : kind === "commentary" ? "commentator"
      : kind === "crowd" ? "crowd" : kind === "shout" ? "shout" : "speech";
    const vp = resolveVoice(d.speaker);
    const anchor = placeBubble(i, panel.dialogue.length, aspect, focus, style);
    const bubble = makeBubble(id, style, anchor.x, anchor.y, autoAnim(style));

    dialogue.push({
      id,
      order: i + 1,
      speaker_label: d.speaker,
      player_id: SPEAKER_TO_PLAYER[d.speaker] ?? null,
      character_id: SPEAKER_TO_CHARACTER[d.speaker] ?? null,
      text: d.text,
      language_label: d.language ?? vp.language_label,
      kind,
      emotion: kind === "shout" ? "excited" : kind === "crowd" ? "roaring" : vp.default_emotion,
      start_override: null,
      bubble_id: bubble.id,
      voice_id: "",
    });
    bubbles.push(bubble);

    const est = estimateDuration(d.text, vp.speed, vp.default_emotion);
    const voice = makeSilentVoice(id, est);
    voices[id] = voice;
    dialogue[dialogue.length - 1].voice_id = voice.id;
  });

  const sfx: SfxInstance[] = (SFX_BY_EVENT[panel.event?.type as EventType] ?? []).map((s) => ({
    id: newId("sfx"),
    sfx: s.sfx,
    start: s.at,
    duration: SFX_LIBRARY[s.sfx].duration,
    gain: 1,
    label: SFX_LIBRARY[s.sfx].label,
    locked: false,
  }));
  sfx.push({
    id: newId("sfx"),
    sfx: "crowd_ambience",
    start: 0,
    duration: 8,
    gain: 0.8,
    label: "Stadium ambience",
    locked: false,
  });

  const characters = panel.character_ids.map((cid, i) => ({
    character_id: fromLegacy(cid),
    role_in_scene: i === 0 ? "primary" : "supporting",
    focus: i === 0,
  }));

  return {
    id: panelId,
    panel_id: panelId,
    panel_number: panel.number,
    title: panel.title,
    event_type: panel.event?.type,
    image: {
      current: makeImageRevision(panel.image_url ?? "", "seed", "image-engine", "imported from the comic project"),
      history: [],
      locked: false,
    },
    characters,
    dialogue,
    voices,
    bubbles,
    sfx,
    music: defaultMusic(),
    camera: { ...defaultCamera(panel.event?.type, focus), focus_character_id: characters[0]?.character_id ?? null },
    transition: defaultTransition(panel.event?.type),
    tail: 0.7,
    revision: 1,
    updated_at: stamp(),
  };
}

function buildProject(): ProjectDocument {
  return {
    id: "mcdoc_citybou",
    comic_project_id: PROJECT.id,
    title: `${PROJECT.name} — Motion Comic`,
    aspect_ratio: "16:9",
    fps: 30,
    scenes: PROJECT.panels.map((p) => buildSceneDocument(p.id)),
    mix: { voice: 1, sfx: 0.85, music: 0.22 },
    revision: 1,
    created_at: stamp(),
    updated_at: stamp(),
  };
}

/* ------------------------------------------------- runtime ---- */

class StudioRuntime {
  private state: StudioState;
  private listeners = new Set<() => void>();
  private saveTimer: number | null = null;

  constructor() {
    const loaded = readFilm();
    if (loaded) {
      const project = loaded.project;
      this.state = {
        project,
        timeline: deriveTimeline(project),
        selection: { kind: "none" },
        mutations: [],
        busy: null,
        exports: [],
        ttsProvider: loaded.ttsProvider ?? "browser",
        imageProvider: "sandbox",
        lastError: null,
        players: loaded.players.length ? loaded.players : SEED_PLAYERS.map((p) => ({ ...p })),
        saveStatus: "saved",
        lastSavedAt: loaded.savedAt,
      };
      return;
    }
    const project = buildProject();
    this.state = {
      project,
      timeline: deriveTimeline(project),
      selection: { kind: "none" },
      mutations: [],
      busy: null,
      exports: [],
      ttsProvider: "browser",
      imageProvider: "sandbox",
      lastError: null,
      players: SEED_PLAYERS.map((p) => ({ ...p })),
      saveStatus: "saved",
      lastSavedAt: null,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** The single write path: patch one scene, re-derive, log the diff. */
  private commit(sceneId: string, patch: (doc: SceneDocument) => SceneDocument, mut: Mutation) {
    const scenes = this.state.project.scenes.map((s) =>
      s.id === sceneId ? { ...patch(s), revision: s.revision + 1, updated_at: stamp() } : s
    );
    const project: ProjectDocument = {
      ...this.state.project,
      scenes,
      revision: this.state.project.revision + 1,
      updated_at: stamp(),
    };
    this.state = {
      ...this.state,
      project,
      timeline: deriveTimeline(project),
      mutations: [mut, ...this.state.mutations].slice(0, 120),
      saveStatus: "unsaved",
    };
    this.emit();
    this.armSave();
  }

  private armSave() {
    if (typeof window === "undefined") return;
    if (this.saveTimer != null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 700);
  }

  async saveNow() {
    try {
      this.state = { ...this.state, saveStatus: "saving" };
      this.emit();
      const project = await materializeProjectImages(this.state.project);
      const savedAt = writeFilm({
        players: this.state.players,
        project,
        ttsProvider: this.state.ttsProvider,
      });
      this.state = { ...this.state, project, saveStatus: "saved", lastSavedAt: savedAt };
      this.emit();
    } catch {
      this.state = { ...this.state, saveStatus: "error", lastError: "Could not save. Storage may be full." };
      this.emit();
    }
  }

  resetFilm() {
    clearFilm();
    const project = buildProject();
    this.state = {
      project,
      timeline: deriveTimeline(project),
      selection: { kind: "none" },
      mutations: [],
      busy: null,
      exports: [],
      ttsProvider: "browser",
      imageProvider: "sandbox",
      lastError: null,
      players: SEED_PLAYERS.map((p) => ({ ...p })),
      saveStatus: "saved",
      lastSavedAt: null,
    };
    this.emit();
  }

  private setPartial(patch: Partial<StudioState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private scene(id: string): SceneDocument {
    return this.state.project.scenes.find((s) => s.id === id)!;
  }

  /* ------------------------------------------- selection ---- */

  select(sel: Selection) {
    this.setPartial({ selection: sel });
  }
  clearError() {
    this.setPartial({ lastError: null });
  }
  setTTSProvider(id: TTSProviderId) {
    this.setPartial({ ttsProvider: id });
  }
  setImageProvider(id: ImageEditProviderId) {
    this.setPartial({ imageProvider: id });
  }

  setAspect(id: AspectSpec["id"]) {
    // Re-places only auto-placed bubbles for the new safe zones.
    // Hand-positioned bubbles are the user's decision and are kept.
    const aspect = ASPECTS[id];
    const scenes = this.state.project.scenes.map((doc) => {
      const bubbles = doc.bubbles.map((b, i) => {
        if (!b.auto_placed) return b;
        const line = doc.dialogue.find((l) => l.bubble_id === b.id);
        const idx = line ? line.order - 1 : i;
        const p = placeBubble(idx, doc.dialogue.length, aspect, doc.camera.focus_point, b.style);
        return { ...b, x: p.x, y: p.y };
      });
      return { ...doc, bubbles };
    });
    const project = { ...this.state.project, aspect_ratio: id, scenes, revision: this.state.project.revision + 1 };
    this.state = {
      ...this.state,
      project,
      timeline: deriveTimeline(project),
      mutations: [
        mutation("aspect.change", "*", ["bubbles"], "free", id, "auto-placed bubbles re-flowed for new safe zones; hand-placed bubbles kept"),
        ...this.state.mutations,
      ].slice(0, 120),
      saveStatus: "unsaved",
    };
    this.emit();
    this.armSave();
  }

  setMix(patch: Partial<ProjectDocument["mix"]>) {
    const project = { ...this.state.project, mix: { ...this.state.project.mix, ...patch } };
    this.setPartial({ project });
  }

  /* --------------------------------------- SCENARIO / SCENES ----
     Add, duplicate, reorder and delete whole scenes. The film is a
     list of documents — restructuring it never re-renders anything.
  --------------------------------------------------------------- */

  private writeScenes(scenes: SceneDocument[], mut: Mutation) {
    const project: ProjectDocument = {
      ...this.state.project,
      scenes,
      revision: this.state.project.revision + 1,
      updated_at: stamp(),
    };
    this.state = {
      ...this.state,
      project,
      timeline: deriveTimeline(project),
      mutations: [mut, ...this.state.mutations].slice(0, 120),
      saveStatus: "unsaved",
    };
    this.emit();
    this.armSave();
  }

  /** Blank scenario — optionally seeded with an uploaded image. */
  private blankScene(index: number, imageUrl: string, note: string, source: "uploaded" | "generated"): SceneDocument {
    const id = `scene_${Math.random().toString(16).slice(2, 8)}`;
    return {
      id,
      panel_id: id,
      panel_number: index,
      title: "New scene",
      event_type: undefined,
      image: { current: makeImageRevision(imageUrl, source, source === "uploaded" ? "upload" : "sandbox", note), history: [], locked: false },
      characters: [],
      dialogue: [],
      voices: {},
      bubbles: [],
      sfx: [{ id: newId("sfx"), sfx: "crowd_ambience", start: 0, duration: 6, gain: 0.8, label: "Stadium ambience", locked: false }],
      music: defaultMusic(),
      camera: defaultCamera(undefined, null),
      transition: defaultTransition(undefined),
      tail: 0.7,
      revision: 1,
      updated_at: stamp(),
    };
  }

  async addSceneFromImage(file: File, afterSceneId?: string) {
    this.setPartial({ busy: `adding scene from ${file.name}`, lastError: null });
    try {
      const up = IMAGE_EDIT_PROVIDERS.upload as unknown as { fromFile: (f: File) => Promise<{ url: string; note: string }> };
      const out = await up.fromFile(file);
      const scenes = [...this.state.project.scenes];
      const at = afterSceneId ? scenes.findIndex((s) => s.id === afterSceneId) + 1 : scenes.length;
      const doc = this.blankScene(at + 1, out.url, out.note, "uploaded");
      scenes.splice(at, 0, doc);
      this.writeScenes(
        renumber(scenes),
        mutation("scene.add", doc.id, ["image"], "free", file.name, "new scenario inserted — existing scenes untouched")
      );
      this.select({ kind: "image", scene: doc.id });
    } catch (e) {
      this.setPartial({ lastError: msg(e) });
    } finally {
      this.setPartial({ busy: null });
    }
  }

  duplicateScene(sceneId: string) {
    const src = this.scene(sceneId);
    const idMap = new Map<string, string>();
    const copyId = `scene_${Math.random().toString(16).slice(2, 8)}`;

    const bubbles = src.bubbles.map((b) => {
      const nid = newId("bub");
      idMap.set(b.id, nid);
      return { ...b, id: nid };
    });
    const dialogue = src.dialogue.map((l) => {
      const nid = `${copyId}-l${l.order}`;
      idMap.set(l.id, nid);
      return { ...l, id: nid, bubble_id: idMap.get(l.bubble_id) ?? l.bubble_id };
    });
    bubbles.forEach((b) => {
      b.dialogue_id = idMap.get(b.dialogue_id) ?? b.dialogue_id;
    });
    const voices: Record<string, VoiceAsset> = {};
    for (const [oldId, v] of Object.entries(src.voices)) {
      const nid = idMap.get(oldId);
      if (nid) voices[nid] = { ...v, id: newId("vox"), dialogue_id: nid };
    }

    const copy: SceneDocument = {
      ...src,
      id: copyId,
      panel_id: copyId,
      title: `${src.title} (copy)`,
      dialogue,
      bubbles,
      voices,
      sfx: src.sfx.map((s) => ({ ...s, id: newId("sfx") })),
      image: { ...src.image, history: [] },
      revision: 1,
      updated_at: stamp(),
    };

    const scenes = [...this.state.project.scenes];
    scenes.splice(scenes.findIndex((s) => s.id === sceneId) + 1, 0, copy);
    this.writeScenes(
      renumber(scenes),
      mutation("scene.duplicate", copy.id, ["image", "dialogue", "voice", "bubbles", "sfx"], "free", sceneId, "deep copy — audio assets are re-used, not re-billed")
    );
    this.select({ kind: "none" });
  }

  deleteScene(sceneId: string) {
    if (this.state.project.scenes.length <= 1) {
      this.setPartial({ lastError: "A project needs at least one scene." });
      return;
    }
    this.writeScenes(
      renumber(this.state.project.scenes.filter((s) => s.id !== sceneId)),
      mutation("scene.delete", sceneId, ["image", "dialogue", "voice", "bubbles", "sfx", "camera"], "free", sceneId, "other scenes are untouched and re-numbered")
    );
    this.select({ kind: "none" });
  }

  moveScene(sceneId: string, dir: -1 | 1) {
    const scenes = [...this.state.project.scenes];
    const i = scenes.findIndex((s) => s.id === sceneId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= scenes.length) return;
    [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
    this.writeScenes(
      renumber(scenes),
      mutation("scene.reorder", sceneId, [], "free", `${i + 1} → ${j + 1}`, "pure re-sequence — every layer preserved")
    );
  }

  updateSceneMeta(sceneId: string, patch: { title?: string; event_type?: EventType; tail?: number }) {
    this.commit(
      sceneId,
      (d) => ({ ...d, ...patch }),
      mutation("scene.meta", sceneId, patch.tail !== undefined ? ["timing"] : [], "free", patch.title ?? patch.event_type)
    );
  }

  /* ---------------------------------------------- IMAGE ---- */

  private pushImage(sceneId: string, rev: ImageRevision, op: string, cost: Mutation["cost"], note: string) {
    this.commit(
      sceneId,
      (doc) => ({
        ...doc,
        image: { ...doc.image, current: rev, history: [doc.image.current, ...doc.image.history].slice(0, 12) },
      }),
      mutation(op, sceneId, ["image"], cost, rev.source, note)
    );
  }

  applyImageUrl(sceneId: string, url: string, note = "library still") {
    this.pushImage(
      sceneId,
      makeImageRevision(url, "seed", "library", note),
      "image.library",
      "free",
      "still swapped — bubbles, names and voices kept"
    );
  }

  async replaceImageFromFile(sceneId: string, file: File) {
    this.setPartial({ busy: `uploading ${file.name}`, lastError: null });
    try {
      const provider = IMAGE_EDIT_PROVIDERS.upload as unknown as { fromFile: (f: File) => Promise<{ url: string; provider: string; source: ImageRevision["source"]; note: string }> };
      const out = await provider.fromFile(file);
      this.pushImage(
        sceneId,
        makeImageRevision(out.url, out.source, out.provider, out.note),
        "image.upload",
        "free",
        "dialogue, voices, bubbles, sfx, camera and timing all preserved"
      );
    } catch (e) {
      this.setPartial({ lastError: msg(e) });
    } finally {
      this.setPartial({ busy: null });
    }
  }

  async regenerateImage(sceneId: string, prompt?: string, edit = false) {
    const doc = this.scene(sceneId);
    const providerId = this.state.imageProvider;
    const provider = IMAGE_EDIT_PROVIDERS[providerId];
    this.setPartial({ busy: `${edit ? "editing" : "generating"} image via ${provider.label}`, lastError: null });
    try {
      const refs = doc.characters
        .map((c) => sportsCharacter(c.character_id)?.reference_images?.[0])
        .filter(Boolean) as string[];
      const out = await provider.generate({
        prompt,
        base_image: edit ? doc.image.current.url : null,
        reference_images: refs,
        panel_key: doc.panel_id,
        variant: doc.image.history.length + 1,
      });
      this.pushImage(
        sceneId,
        makeImageRevision(out.url, out.source, out.provider, out.note, prompt),
        edit ? "image.ai_edit" : "image.regenerate",
        "image",
        "every other layer untouched — dialogue, voice, bubbles, sfx, camera, timing"
      );
    } catch (e) {
      this.setPartial({ lastError: msg(e) });
    } finally {
      this.setPartial({ busy: null });
    }
  }

  revertImage(sceneId: string) {
    const doc = this.scene(sceneId);
    if (!doc.image.history.length) return;
    const [prev, ...rest] = doc.image.history;
    this.commit(
      sceneId,
      (d) => ({ ...d, image: { ...d.image, current: prev, history: rest } }),
      mutation("image.revert", sceneId, ["image"], "free", prev.source, "restored the previous revision; nothing else changed")
    );
  }

  /* ----------------------------------------- CHARACTERS ---- */

  addCharacter(sceneId: string, characterId: string) {
    this.commit(
      sceneId,
      (doc) =>
        doc.characters.some((c) => c.character_id === characterId)
          ? doc
          : { ...doc, characters: [...doc.characters, { character_id: characterId, role_in_scene: "supporting", focus: false }] },
      mutation("character.add", sceneId, ["characters"], "free", characterId, "Sports Bible reference attached; no assets regenerated")
    );
  }

  removeCharacter(sceneId: string, characterId: string) {
    this.commit(
      sceneId,
      (doc) => ({ ...doc, characters: doc.characters.filter((c) => c.character_id !== characterId) }),
      mutation("character.remove", sceneId, ["characters"], "free", characterId)
    );
  }

  setFocusCharacter(sceneId: string, characterId: string) {
    this.commit(
      sceneId,
      (doc) => ({
        ...doc,
        characters: doc.characters.map((c) => ({ ...c, focus: c.character_id === characterId })),
        camera: { ...doc.camera, focus_character_id: characterId, auto: false },
      }),
      mutation("camera.focus_character", sceneId, ["characters", "camera"], "free", characterId, "image untouched")
    );
  }

  /* ------------------------------------------- DIALOGUE ---- */

  editDialogueText(sceneId: string, lineId: string, text: string) {
    const doc = this.scene(sceneId);
    const voice = doc.voices[lineId];
    const stale = voice && voice.source !== "silent";
    this.commit(
      sceneId,
      (d) => ({
        ...d,
        dialogue: d.dialogue.map((l) => (l.id === lineId ? { ...l, text } : l)),
        voices: stale
          ? { ...d.voices, [lineId]: { ...voice, label: `${voice.label} · STALE (text changed)`, cache_key: null } }
          : {
              ...d.voices,
              [lineId]: { ...d.voices[lineId], duration: estimateDuration(text, 1, "confident") },
            },
      }),
      mutation(
        "dialogue.edit_text",
        sceneId,
        stale ? ["dialogue"] : ["dialogue", "timing"],
        "free",
        lineId,
        stale
          ? "image and bubble untouched; existing audio flagged stale — regenerate when you're ready"
          : "image and bubble untouched; estimated timing refreshed"
      )
    );
  }

  setDialogueField(sceneId: string, lineId: string, patch: Partial<DialogueLayerLine>) {
    this.commit(
      sceneId,
      (d) => ({ ...d, dialogue: d.dialogue.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }),
      mutation("dialogue.update", sceneId, ["dialogue"], "free", lineId, "image, voice audio and bubble geometry preserved")
    );
  }

  pinDialogueStart(sceneId: string, lineId: string, start: number | null) {
    this.commit(
      sceneId,
      (d) => ({ ...d, dialogue: d.dialogue.map((l) => (l.id === lineId ? { ...l, start_override: start } : l)) }),
      mutation("timing.pin", sceneId, ["dialogue", "timing"], "free", lineId, start == null ? "released back to auto-flow" : `pinned to ${start.toFixed(2)}s`)
    );
  }

  addDialogueLine(sceneId: string, speaker = "City Midfielder") {
    const player = this.ensurePlayer(speaker);
    const doc = this.scene(sceneId);
    const id = `${sceneId}-l${doc.dialogue.length + 1}-${Math.random().toString(16).slice(2, 5)}`;
    const vp = resolveVoice(speaker);
    const aspect = ASPECTS[this.state.project.aspect_ratio];
    const anchor = placeBubble(doc.dialogue.length, doc.dialogue.length + 1, aspect, doc.camera.focus_point, "speech");
    const bubble = makeBubble(id, "speech", anchor.x, anchor.y, autoAnim("speech"));
    const voice = makeSilentVoice(id, 1.4);
    this.commit(
      sceneId,
      (d) => ({
        ...d,
        dialogue: [
          ...d.dialogue,
          {
            id, order: d.dialogue.length + 1, speaker_label: player.name,
            player_id: player.id,
            character_id: SPEAKER_TO_CHARACTER[speaker] ?? null,
            text: "New line — type your dialogue.",
            language_label: vp.language_label, kind: "speech", emotion: vp.default_emotion,
            start_override: null, bubble_id: bubble.id, voice_id: voice.id,
          },
        ],
        bubbles: [...d.bubbles, bubble],
        voices: { ...d.voices, [id]: voice },
      }),
      mutation("dialogue.add", sceneId, ["dialogue", "bubbles", "timing"], "free", id, "image untouched")
    );
    this.select({ kind: "dialogue", scene: sceneId, id });
  }

  deleteDialogueLine(sceneId: string, lineId: string) {
    const doc = this.scene(sceneId);
    const line = doc.dialogue.find((l) => l.id === lineId);
    this.commit(
      sceneId,
      (d) => {
        const voices = { ...d.voices };
        delete voices[lineId];
        return {
          ...d,
          dialogue: d.dialogue.filter((l) => l.id !== lineId).map((l, i) => ({ ...l, order: i + 1 })),
          bubbles: d.bubbles.filter((b) => b.id !== line?.bubble_id),
          voices,
        };
      },
      mutation("dialogue.delete", sceneId, ["dialogue", "bubbles", "voice", "timing"], "free", lineId, "image untouched")
    );
    this.select({ kind: "none" });
  }

  /* --------------------------------------------- BUBBLE ---- */

  updateBubble(sceneId: string, bubbleId: string, patch: Partial<BubbleLayer>, opLabel = "bubble.update") {
    const manual = patch.x !== undefined || patch.y !== undefined || patch.width !== undefined;
    this.commit(
      sceneId,
      (d) => ({
        ...d,
        bubbles: d.bubbles.map((b) =>
          b.id === bubbleId ? { ...b, ...patch, auto_placed: manual ? false : b.auto_placed } : b
        ),
      }),
      mutation(
        opLabel,
        sceneId,
        patch.lead !== undefined || patch.hold !== undefined ? ["bubbles", "timing"] : ["bubbles"],
        "free",
        bubbleId,
        "no image regenerated, no voice re-synthesized"
      )
    );
  }

  applyBubblePreset(sceneId: string, bubbleId: string, style: BubbleStyle) {
    const preset = {
      speech: { fill: "#F7F5EF", text_color: "#12140F", stroke: "#12140F" },
      shout: { fill: "#FFE9C7", text_color: "#20150A", stroke: "#20150A" },
      whisper: { fill: "#EEF2EA", text_color: "#2A2F27", stroke: "#6C7268" },
      thought: { fill: "#EFF3FA", text_color: "#171B22", stroke: "#3B4250" },
      commentator: { fill: "#101410", text_color: "#F2F6EE", stroke: "#3DD68C" },
      narration: { fill: "#14120C", text_color: "#F5EEDC", stroke: "#E8C15A" },
      crowd: { fill: "#0C100C", text_color: "#EAF6E8", stroke: "#6CB4EE" },
    }[style];
    this.updateBubble(sceneId, bubbleId, { style, anim_in: autoAnim(style), ...preset }, "bubble.style");
  }

  duplicateBubble(sceneId: string, bubbleId: string) {
    const doc = this.scene(sceneId);
    const src = doc.bubbles.find((b) => b.id === bubbleId);
    if (!src) return;
    const copy: BubbleLayer = { ...src, id: newId("bub"), x: Math.min(0.9, src.x + 0.06), y: Math.min(0.9, src.y + 0.07), auto_placed: false };
    this.commit(
      sceneId,
      (d) => ({ ...d, bubbles: [...d.bubbles, copy] }),
      mutation("bubble.duplicate", sceneId, ["bubbles"], "free", copy.id, "shares its dialogue line; image and audio untouched")
    );
    this.select({ kind: "bubble", scene: sceneId, id: copy.id });
  }

  deleteBubble(sceneId: string, bubbleId: string) {
    this.commit(
      sceneId,
      (d) => ({ ...d, bubbles: d.bubbles.filter((b) => b.id !== bubbleId) }),
      mutation("bubble.delete", sceneId, ["bubbles"], "free", bubbleId, "dialogue line and its audio are kept")
    );
    this.select({ kind: "none" });
  }

  /* ---------------------------------------------- VOICE ---- */

  async generateVoice(sceneId: string, lineId: string) {
    const doc = this.scene(sceneId);
    const line = doc.dialogue.find((l) => l.id === lineId);
    if (!line) return;
    const providerId = this.state.ttsProvider;
    const provider = TTS_PROVIDERS[providerId];
    if (!provider.capabilities.configured) {
      this.setPartial({ lastError: `${provider.label} is not configured in this environment.` });
      return;
    }
    this.setPartial({ busy: `synthesizing “${line.text.slice(0, 28)}…”`, lastError: null });
    try {
      const vp = voiceProfile(resolveVoice(line.speaker_label).id);
      const prev = doc.voices[lineId];
      const req = { text: line.text, voice: vp, emotion: line.emotion, speed: prev?.speed ?? vp.speed, pitch: prev?.pitch ?? vp.pitch, language: vp.language };
      const res = await provider.generate(req);
      const asset: VoiceAsset = {
        id: newId("vox"),
        dialogue_id: lineId,
        source: "ai",
        provider: providerId,
        voice_profile_id: vp.id,
        url: res.url,
        duration: res.duration,
        duration_source: res.duration_source,
        gain: prev?.gain ?? 1,
        speed: prev?.speed ?? vp.speed,
        pitch: prev?.pitch ?? vp.pitch,
        offset: prev?.offset ?? 0,
        cache_key: cacheKey(req),
        label: `AI · ${vp.label}`,
        created_at: stamp(),
      };
      this.commit(
        sceneId,
        (d) => ({
          ...d,
          voices: { ...d.voices, [lineId]: asset },
          dialogue: d.dialogue.map((l) => (l.id === lineId ? { ...l, voice_id: asset.id } : l)),
        }),
        mutation("voice.generate", sceneId, ["voice", "timing"], "voice", lineId, "image and bubble untouched; bubble re-synced to the new duration")
      );
    } catch (e) {
      this.setPartial({ lastError: msg(e) });
    } finally {
      this.setPartial({ busy: null });
    }
  }

  async generateAllVoices() {
    for (const scene of this.state.project.scenes) {
      for (const line of scene.dialogue) {
        if (scene.voices[line.id]?.source === "ai" && scene.voices[line.id]?.cache_key) continue;
        await this.generateVoice(scene.id, line.id);
      }
    }
  }

  /** Attach the user's own audio — upload or live recording. */
  attachUserVoice(sceneId: string, lineId: string, audio: UserAudioResult, source: VoiceSource) {
    const prev = this.scene(sceneId).voices[lineId];
    const asset: VoiceAsset = {
      id: newId("vox"),
      dialogue_id: lineId,
      source,
      provider: "user",
      voice_profile_id: null,
      url: audio.url,
      duration: audio.duration,
      duration_source: "measured",
      gain: prev?.gain ?? 1,
      speed: 1,
      pitch: 1,
      offset: prev?.offset ?? 0,
      cache_key: null,
      label: source === "record" ? "Your recording" : `Upload · ${audio.label}`,
      created_at: stamp(),
    };
    this.commit(
      sceneId,
      (d) => ({
        ...d,
        voices: { ...d.voices, [lineId]: asset },
        dialogue: d.dialogue.map((l) => (l.id === lineId ? { ...l, voice_id: asset.id } : l)),
      }),
      mutation(
        source === "record" ? "voice.record" : "voice.upload",
        sceneId,
        ["voice", "timing"],
        "free",
        lineId,
        `measured ${audio.duration.toFixed(2)}s — timeline and bubble re-synced; image untouched`
      )
    );
  }

  updateVoice(sceneId: string, lineId: string, patch: Partial<VoiceAsset>) {
    this.commit(
      sceneId,
      (d) => ({ ...d, voices: { ...d.voices, [lineId]: { ...d.voices[lineId], ...patch } } }),
      mutation("voice.adjust", sceneId, ["voice", "timing"], "free", lineId, "no re-synthesis, no image change")
    );
  }

  deleteVoice(sceneId: string, lineId: string) {
    const doc = this.scene(sceneId);
    const line = doc.dialogue.find((l) => l.id === lineId);
    const est = estimateDuration(line?.text ?? "", 1, line?.emotion ?? "confident");
    this.commit(
      sceneId,
      (d) => ({ ...d, voices: { ...d.voices, [lineId]: makeSilentVoice(lineId, est) } }),
      mutation("voice.delete", sceneId, ["voice", "timing"], "free", lineId, "dialogue text and bubble kept; timing falls back to an estimate")
    );
  }

  /** Reconcile against what actually played (browser speech). */
  reportMeasured(sceneId: string, lineId: string, measured: number) {
    const doc = this.state.project.scenes.find((s) => s.id === sceneId);
    const v = doc?.voices[lineId];
    if (!v || measured < 0.25 || Math.abs(v.duration - measured) < 0.16) return;
    const scenes = this.state.project.scenes.map((s) =>
      s.id !== sceneId ? s : { ...s, voices: { ...s.voices, [lineId]: { ...v, duration: +measured.toFixed(3), duration_source: "measured" as const } } }
    );
    const project = { ...this.state.project, scenes };
    this.state = { ...this.state, project, timeline: deriveTimeline(project) };
    this.emit();
  }

  /* ----------------------------------------------- SFX ---- */

  addSfx(sceneId: string, sfx: SfxId, start = 0) {
    const spec = SFX_LIBRARY[sfx];
    const inst: SfxInstance = { id: newId("sfx"), sfx, start, duration: spec.duration, gain: 1, label: spec.label, locked: false };
    this.commit(
      sceneId,
      (d) => ({ ...d, sfx: [...d.sfx, inst] }),
      mutation("sfx.add", sceneId, ["sfx"], "free", sfx, "independent asset — nothing else touched")
    );
    this.select({ kind: "sfx", scene: sceneId, id: inst.id });
  }

  replaceSfx(sceneId: string, instId: string, sfx: SfxId) {
    const spec = SFX_LIBRARY[sfx];
    this.commit(
      sceneId,
      (d) => ({ ...d, sfx: d.sfx.map((s) => (s.id === instId ? { ...s, sfx, label: spec.label, duration: spec.duration } : s)) }),
      mutation("sfx.replace", sceneId, ["sfx"], "free", sfx, "voice, image and bubbles untouched")
    );
  }

  updateSfx(sceneId: string, instId: string, patch: Partial<SfxInstance>) {
    this.commit(
      sceneId,
      (d) => ({ ...d, sfx: d.sfx.map((s) => (s.id === instId ? { ...s, ...patch } : s)) }),
      mutation("sfx.update", sceneId, ["sfx"], "free", instId)
    );
  }

  deleteSfx(sceneId: string, instId: string) {
    this.commit(
      sceneId,
      (d) => ({ ...d, sfx: d.sfx.filter((s) => s.id !== instId) }),
      mutation("sfx.delete", sceneId, ["sfx"], "free", instId)
    );
    this.select({ kind: "none" });
  }

  /* -------------------------------------------- CAMERA ---- */

  updateCamera(sceneId: string, patch: Partial<CameraLayer>) {
    this.commit(
      sceneId,
      (d) => ({ ...d, camera: { ...d.camera, ...patch, auto: false } }),
      mutation("camera.update", sceneId, ["camera"], "free", patch.move ?? "params", "image untouched, audio untouched")
    );
  }

  resetCamera(sceneId: string) {
    const doc = this.scene(sceneId);
    this.commit(
      sceneId,
      (d) => ({ ...d, camera: defaultCamera(doc.event_type, FOCUS_HINTS[doc.panel_id] ?? null) }),
      mutation("camera.reset", sceneId, ["camera"], "free", "auto", "restored the event-derived move")
    );
  }

  /* ---------------------------------- TRANSITION / MUSIC ---- */

  updateTransition(sceneId: string, kind: TransitionKind, duration?: number) {
    this.commit(
      sceneId,
      (d) => ({ ...d, transition: { kind, duration: duration ?? d.transition.duration, auto: false } }),
      mutation("transition.update", sceneId, ["transition"], "free", kind)
    );
  }

  updateMusic(sceneId: string, patch: Partial<SceneDocument["music"]>) {
    this.commit(
      sceneId,
      (d) => ({ ...d, music: { ...d.music, ...patch } }),
      mutation("music.update", sceneId, ["music"], "free")
    );
  }

  async attachMusic(sceneId: string, file: File) {
    try {
      const url = URL.createObjectURL(file);
      await measureAudio(url);
      this.commit(
        sceneId,
        (d) => ({ ...d, music: { ...d.music, enabled: true, url, label: file.name } }),
        mutation("music.attach", sceneId, ["music"], "free", file.name, "user-supplied licensed track")
      );
    } catch (e) {
      this.setPartial({ lastError: msg(e) });
    }
  }

  /* --------------------------------------------- EXPORT ---- */

  startExport(totalScenes: number): ExportJob {
    const job: ExportJob = {
      id: newId("exp"),
      status: "rendering",
      progress: 0,
      current_scene: 1,
      total_scenes: totalScenes,
      url: null,
      bytes: null,
      mime: "video/webm",
      error: null,
      created_at: stamp(),
      project_revision_at_export: this.state.project.revision,
    };
    this.setPartial({ exports: [job, ...this.state.exports] });
    return job;
  }
  updateExport(id: string, patch: Partial<ExportJob>) {
    this.setPartial({ exports: this.state.exports.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }
  cancelExport(id: string) {
    this.updateExport(id, { status: "cancelled" });
  }

  /* --------------------------------------------- PLAYERS ---- */

  ensurePlayer(name: string, extras?: Partial<Player>): Player {
    const trimmed = name.trim();
    if (!trimmed) {
      return this.state.players[0] ?? SEED_PLAYERS[0];
    }
    const existing = playerByName(this.state.players, trimmed);
    if (existing) {
      if (extras && Object.keys(extras).length) this.updatePlayer(existing.id, extras);
      return playerByName(this.state.players, trimmed) ?? existing;
    }
    const player: Player = {
      id: newPlayerId(),
      name: trimmed,
      team: extras?.team ?? "city",
      voiceName: extras?.voiceName ?? "",
      voiceLang: extras?.voiceLang ?? "en-NG",
      gender: extras?.gender ?? "male",
      speed: extras?.speed ?? 1,
      pitch: extras?.pitch ?? 1,
      language_label: extras?.language_label ?? "Nigerian Pidgin",
    };
    this.state = { ...this.state, players: [...this.state.players, player], saveStatus: "unsaved" };
    this.emit();
    this.armSave();
    return player;
  }

  addPlayer(name: string, extras?: Partial<Player>): Player | null {
    const trimmed = name.trim();
    if (!trimmed) {
      this.setPartial({ lastError: "Type a player name first." });
      return null;
    }
    if (playerByName(this.state.players, trimmed)) {
      this.setPartial({ lastError: `"${trimmed}" is already on the roster.` });
      return playerByName(this.state.players, trimmed) ?? null;
    }
    return this.ensurePlayer(trimmed, extras);
  }

  updatePlayer(id: string, patch: Partial<Player>) {
    const prev = this.state.players.find((p) => p.id === id);
    if (!prev) return;
    const next = { ...prev, ...patch };
    const players = this.state.players.map((p) => (p.id === id ? next : p));
    let project = this.state.project;
    if (patch.name && patch.name !== prev.name) {
      const scenes = project.scenes.map((s) => ({
        ...s,
        dialogue: s.dialogue.map((l) => (l.player_id === id || l.speaker_label === prev.name ? { ...l, speaker_label: next.name, player_id: id } : l)),
      }));
      project = { ...project, scenes, revision: project.revision + 1, updated_at: stamp() };
    }
    this.state = {
      ...this.state,
      players,
      project,
      timeline: deriveTimeline(project),
      saveStatus: "unsaved",
    };
    this.emit();
    this.armSave();
  }

  removePlayer(id: string) {
    if (this.state.players.length <= 1) {
      this.setPartial({ lastError: "Keep at least one player." });
      return;
    }
    this.state = { ...this.state, players: this.state.players.filter((p) => p.id !== id), saveStatus: "unsaved" };
    this.emit();
    this.armSave();
  }

  setSpeaker(sceneId: string, lineId: string, name: string) {
    const player = this.ensurePlayer(name);
    this.commit(
      sceneId,
      (d) => ({
        ...d,
        dialogue: d.dialogue.map((l) =>
          l.id === lineId
            ? { ...l, speaker_label: player.name, player_id: player.id, language_label: player.language_label }
            : l
        ),
      }),
      mutation("dialogue.speaker", sceneId, ["dialogue"], "free", player.name, "voice assignment follows this player")
    );
  }

  playerForLine(line: DialogueLayerLine): Player | undefined {
    return this.state.players.find((p) => p.id === line.player_id) ?? playerByName(this.state.players, line.speaker_label);
  }

  speakDialogue(sceneId: string, lineId: string, onEnd?: (r: SpokenResult) => void) {
    const doc = this.scene(sceneId);
    const line = doc?.dialogue.find((l) => l.id === lineId);
    if (!line) {
      onEnd?.({ measured: 0, cancelled: true });
      return;
    }
    const player = this.playerForLine(line);
    speakText(
      line.text,
      {
        voiceName: player?.voiceName,
        lang: player?.voiceLang,
        rate: player?.speed,
        pitch: player?.pitch,
      },
      (r) => {
        if (!r.cancelled) this.reportMeasured(sceneId, lineId, r.measured);
        onEnd?.(r);
      }
    );
  }

  previewPlayer(id: string) {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) return;
    speakText(`My name is ${p.name}. Omo, we don win am!`, {
      voiceName: p.voiceName,
      lang: p.voiceLang,
      rate: p.speed,
      pitch: p.pitch,
    });
  }

  stopVoices() {
    stopSpeech();
  }

  hydrateDefaultVoices(voices: { name: string; lang: string }[]) {
    if (!voices.length) return;
    let changed = false;
    const players = this.state.players.map((p) => {
      if (p.voiceName) return p;
      const want = p.gender === "female" ? /female|zira|samantha|hazel|susan|karen|tessa|fiona/i : /male|daniel|david|george|fred|ravi|thomas|google uk english male/i;
      const byLang = voices.filter((v) => v.lang.toLowerCase().startsWith((p.voiceLang || "en").split("-")[0]));
      const hit = byLang.find((v) => want.test(v.name)) ?? byLang[0] ?? voices[0];
      if (!hit) return p;
      changed = true;
      return { ...p, voiceName: hit.name, voiceLang: hit.lang || p.voiceLang };
    });
    if (!changed) return;
    this.state = { ...this.state, players, saveStatus: "unsaved" };
    this.emit();
    this.armSave();
  }

  /* --------------------------------------------- derived ---- */

  timingFor(sceneId: string) {
    return computeTiming(this.scene(sceneId));
  }
  sceneDoc(sceneId: string) {
    return this.state.project.scenes.find((s) => s.id === sceneId);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Scene numbers always reflect running order. */
function renumber(scenes: SceneDocument[]): SceneDocument[] {
  return scenes.map((s, i) => (s.panel_number === i + 1 ? s : { ...s, panel_number: i + 1 }));
}

export const studio = new StudioRuntime();

/* ---------------------------------------------------- hooks ---- */

export function useStudio(): StudioState {
  return useSyncExternalStore(studio.subscribe, studio.getState);
}

export { ALL_LAYERS, deriveScene, computeTiming };
export type { SceneDocument, ProjectDocument, Mutation, LayerName, BubbleLayer, VoiceAsset, DialogueLayerLine, SfxInstance, CameraLayer };
export type { CameraMove };
export type { Player, PlayerTeam } from "./players";

