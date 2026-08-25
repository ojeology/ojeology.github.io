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
  localStorage.setItem(KEY, JSON.stringify(payload));
  return savedAt;
}

export async function materializeProjectImages(project: ProjectDocument): Promise<ProjectDocument> {
  const scenes = await Promise.all(
    project.scenes.map(async (s) => {
      const url = s.image.current.url;
      if (!url || !url.startsWith("blob:")) return s;
      try {
        const data = await blobToDataUrl(url);
        return { ...s, image: { ...s.image, current: { ...s.image.current, url: data } } };
      } catch {
        return s;
      }
    })
  );
  return { ...project, scenes };
}

function blobToDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        })
    );
}

export function clearFilm() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
