import type { ProjectDocument } from "./document";
import type { Player } from "./players";
import type { TTSProviderId } from "./types";

const KEY = "bryme.film.v1";

export interface SavedFilm {
  v: 1;
  savedAt: string;
  players: Player[];
  project: ProjectDocument;
  ttsProvider: TTSProviderId;
}

export function readFilm(): SavedFilm | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SavedFilm;
    if (data?.v !== 1 || !data.project?.scenes?.length || !Array.isArray(data.players)) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeFilm(data: Omit<SavedFilm, "v" | "savedAt">): string {
  const savedAt = new Date().toISOString();
  const payload: SavedFilm = { v: 1, savedAt, ...data };
  const json = JSON.stringify(payload);
  localStorage.setItem(KEY, json);
  return savedAt;
}

export function clearFilm() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
