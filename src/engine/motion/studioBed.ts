import type { ProjectDocument, VoiceAsset } from "./document";

/** Recorded studio takes for the seed match. Play these instead of the browser voice. */
export interface StudioClip {
  url: string;
  duration: number;
  text: string;
}

export const STUDIO_VOICES: Record<string, StudioClip> = {
  "panel-01-l2": { url: "/audio/studio/panel-01-l2.mp3", duration: 3.37, text: "Make we just start this thing abeg." },
  "panel-01-l3": { url: "/audio/studio/panel-01-l3.mp3", duration: 4.21, text: "You go try. You no go score today." },
  "panel-01-l4": { url: "/audio/studio/panel-01-l4.mp3", duration: 4.15, text: "Relax my guy. Today na our day." },
  "panel-07-l1": { url: "/audio/studio/panel-07-l1.mp3", duration: 5.76, text: "NOT TODAY! You hear me?! NOT TODAY!" },
  "panel-07-l2": { url: "/audio/studio/panel-07-l2.mp3", duration: 3.76, text: "Ah! How this man take reach there?!" },
  "panel-12-l1": { url: "/audio/studio/panel-12-l1.mp3", duration: 4.36, text: "Ref abeg, na handball! Everybody see am!" },
  "panel-12-l2": { url: "/audio/studio/panel-12-l2.mp3", duration: 3.04, text: "You dey dream. Play on!" },
  "panel-20-l1": { url: "/audio/studio/panel-20-l1.mp3", duration: 2.59, text: "Omo, we don win am!" },
  "panel-21-l1": { url: "/audio/studio/panel-21-l1.mp3", duration: 4.59, text: "WE GO WIN AM! WE GO WIN AM!" },
  "panel-21-l3": { url: "/audio/studio/panel-21-l3.mp3", duration: 4.5, text: "This one na for the fans. Una too much." },
};

export function studioClipFor(lineId: string, text: string): StudioClip | undefined {
  const clip = STUDIO_VOICES[lineId];
  if (!clip) return undefined;
  if (clip.text.trim() !== text.trim()) return undefined;
  return clip;
}

export function mergeStudioVoices(project: ProjectDocument): ProjectDocument {
  let any = false;
  const scenes = project.scenes.map((s) => {
    let changed = false;
    const voices = { ...s.voices };
    for (const line of s.dialogue) {
      const clip = studioClipFor(line.id, line.text);
      if (!clip) continue;
      const prev = voices[line.id];
      if (prev?.source === "upload" || prev?.source === "record") continue;
      if (prev?.url === clip.url) continue;
      const next: VoiceAsset = {
        id: prev?.id ?? `vox_${line.id}`,
        dialogue_id: line.id,
        source: "ai",
        provider: "studio",
        voice_profile_id: prev?.voice_profile_id ?? null,
        url: clip.url,
        duration: clip.duration,
        duration_source: "measured",
        gain: prev?.gain ?? 1,
        speed: 1,
        pitch: 1,
        offset: prev?.offset ?? 0,
        cache_key: prev?.cache_key ?? null,
        label: "Studio voice",
        created_at: prev?.created_at ?? new Date().toISOString(),
      };
      voices[line.id] = next;
      changed = true;
    }
    if (!changed) return s;
    any = true;
    return { ...s, voices };
  });
  return any ? { ...project, scenes } : project;
}
