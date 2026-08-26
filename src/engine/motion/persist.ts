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
    data.project = dropDeadBlobs(data.project);
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
      let image = s.image;
      const imgUrl = s.image.current.url;
      if (imgUrl?.startsWith("blob:")) {
        try {
          const data = await blobToDataUrl(imgUrl);
          image = { ...s.image, current: { ...s.image.current, url: data } };
        } catch {
          /* keep blob */
        }
      }
      const voices = { ...s.voices };
      for (const [id, v] of Object.entries(voices)) {
        if (v.url?.startsWith("blob:")) {
          try {
            voices[id] = { ...v, url: await blobToDataUrl(v.url) };
          } catch {
            /* keep blob */
          }
        }
      }
      return { ...s, image, voices };
    })
  );
  return { ...project, scenes };
}

export function blobToDataUrl(url: string): Promise<string> {
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

function dropDeadBlobs(project: ProjectDocument): ProjectDocument {
  const scenes = project.scenes.map((s) => {
    let image = s.image;
    if (image.current.url?.startsWith("blob:")) {
      image = { ...image, current: { ...image.current, url: "" } };
    }
    const voices = { ...s.voices };
    for (const [id, v] of Object.entries(voices)) {
      if (v.url?.startsWith("blob:")) {
        voices[id] = {
          ...v,
          url: null,
          label: v.source === "record" || v.source === "upload" ? "Your voice — tap Record again" : v.label,
        };
      }
    }
    return { ...s, image, voices };
  });
  return { ...project, scenes };
}

export function clearFilm() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
