/* ============================================================
   BRYME — EDITOR PROVIDER ABSTRACTIONS

   Two families, both pluggable, neither hard-coded into the editor:

     ImageEditProvider   gemini | upload | sandbox | (future)
     UserVoiceProvider   upload | record

   Architecture (never violated):
     BRYME FRONTEND → BRYME BACKEND → IMAGE PROVIDER → Gemini
   The browser never holds a vendor key and never calls Gemini
   directly. Adapters below either post to our own backend route or
   work purely locally (upload/record).
   ============================================================ */

import { stableSeed } from "../providers";
import type { ImageSource } from "./document";

/* =============================== IMAGE ======================== */

export type ImageEditProviderId = "sandbox" | "gemini" | "upload";

export interface ImageEditCapabilities {
  configured: boolean;
  text_to_image: boolean;
  image_to_image: boolean;      // "edit this image with a prompt"
  character_reference: boolean; // accepts Sports Bible reference images
  requires_backend: boolean;
  notes: string;
}

export interface ImageEditRequest {
  prompt?: string;
  base_image?: string | null;        // for edits
  reference_images?: string[];       // Sports Bible refs
  panel_key: string;
  variant?: number;
}

export interface ImageEditResult {
  url: string;
  provider: string;
  source: ImageSource;
  note: string;
  latency_ms: number;
}

export class ImageEditError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ImageEditProvider {
  id: ImageEditProviderId;
  label: string;
  model: string;
  capabilities: ImageEditCapabilities;
  generate(req: ImageEditRequest): Promise<ImageEditResult>;
}

/* ---- sandbox: deterministic, in-cluster, always available ---- */

const VARIANT_POOL: Record<string, string[]> = {
  "panel-01": ["/panels/panel-01-kickoff.jpg"],
  "panel-07": ["/panels/panel-07-penalty-save.jpg"],
  "panel-12": ["/panels/panel-12-var.jpg"],
  "panel-20": ["/panels/panel-20-winner.jpg", "/panels/panel-20-winner-v2.jpg"],
  "panel-21": ["/panels/panel-21-crowd.jpg"],
};
const ALL_FRAMES = [
  "/panels/panel-20-winner.jpg", "/panels/panel-20-winner-v2.jpg",
  "/panels/panel-07-penalty-save.jpg", "/panels/panel-12-var.jpg",
  "/panels/panel-01-kickoff.jpg", "/panels/panel-21-crowd.jpg",
];

export class SandboxImageProvider implements ImageEditProvider {
  id = "sandbox" as const;
  label = "Sandbox Renderer";
  model = "bryme/mock-renderer-1";
  capabilities: ImageEditCapabilities = {
    configured: true,
    text_to_image: true,
    image_to_image: true,
    character_reference: true,
    requires_backend: false,
    notes: "Deterministic local renderer — free, offline, used for the editor demo and CI.",
  };

  async generate(req: ImageEditRequest): Promise<ImageEditResult> {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 900 + Math.random() * 800));
    const pool = VARIANT_POOL[req.panel_key] ?? ALL_FRAMES;
    const v = req.variant ?? stableSeed(req.prompt ?? req.panel_key);
    const url = pool.length > 1 ? pool[v % pool.length] : (pool[0] ?? ALL_FRAMES[v % ALL_FRAMES.length]);
    return {
      url,
      provider: this.id,
      source: req.base_image ? "ai_edited" : "generated",
      note: req.base_image ? `sandbox edit — "${(req.prompt ?? "").slice(0, 48)}"` : "sandbox regeneration",
      latency_ms: Math.round(performance.now() - t0),
    };
  }
}

/* ---- gemini: server-side only ---- */

export class GeminiImageProvider implements ImageEditProvider {
  id = "gemini" as const;
  label = "Google Gemini";
  model = "gemini-2.5-flash-image";
  capabilities: ImageEditCapabilities = {
    configured: false,   // no key in the browser — by design
    text_to_image: true,
    image_to_image: true,
    character_reference: true,
    requires_backend: true,
    notes:
      "Native image generation + conversational editing. Called only from the BRYME backend " +
      "(app/providers/gemini_provider.py); GEMINI_API_KEY never reaches the browser.",
  };

  /**
   * Posts to our own backend, which holds the credential and talks to
   * Gemini. If the route is unreachable (this static control room), we
   * surface a precise, honest error instead of faking a render.
   */
  async generate(req: ImageEditRequest): Promise<ImageEditResult> {
    const t0 = performance.now();
    let resp: Response;
    try {
      resp = await fetch("/api/v1/images/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          prompt: req.prompt,
          base_image: req.base_image,
          reference_images: req.reference_images ?? [],
          panel_key: req.panel_key,
        }),
      });
    } catch {
      throw new ImageEditError(
        "BACKEND_UNREACHABLE",
        "No BRYME backend is attached to this control room, so the Gemini adapter cannot be reached. " +
          "Run the FastAPI service with GEMINI_API_KEY set, or use the Sandbox provider here.",
        true
      );
    }
    if (resp.status === 404) {
      throw new ImageEditError(
        "BACKEND_UNREACHABLE",
        "Backend route /api/v1/images/edit is not mounted in this environment. Start the FastAPI service to use Gemini.",
        true
      );
    }
    if (resp.status === 400 || resp.status === 401) {
      throw new ImageEditError("PROVIDER_NOT_CONFIGURED", "Backend reports GEMINI_API_KEY is missing or rejected.", false);
    }
    if (!resp.ok) {
      throw new ImageEditError("PROVIDER_FAILED", `Gemini adapter returned HTTP ${resp.status}.`, true);
    }
    const data = (await resp.json()) as { image_url: string };
    return {
      url: data.image_url,
      provider: this.id,
      source: req.base_image ? "ai_edited" : "generated",
      note: `gemini — "${(req.prompt ?? "").slice(0, 48)}"`,
      latency_ms: Math.round(performance.now() - t0),
    };
  }
}

/* ---- upload: local file, no provider at all ---- */

export class UploadImageProvider implements ImageEditProvider {
  id = "upload" as const;
  label = "Upload / Replace";
  model = "local-file";
  capabilities: ImageEditCapabilities = {
    configured: true,
    text_to_image: false,
    image_to_image: false,
    character_reference: false,
    requires_backend: false,
    notes: "Bring your own artwork. Stored as a scene revision like any other image.",
  };

  async generate(): Promise<ImageEditResult> {
    throw new ImageEditError("USE_FILE_PICKER", "Upload provider is driven by the file picker, not a prompt.", false);
  }

  async fromFile(file: File): Promise<ImageEditResult> {
    if (!file.type.startsWith("image/")) {
      throw new ImageEditError("INVALID_MIME", `"${file.type || "unknown"}" is not an image.`, false);
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new ImageEditError("FILE_TOO_LARGE", "Images are limited to 20 MB.", false);
    }
    return {
      url: URL.createObjectURL(file),
      provider: this.id,
      source: "uploaded",
      note: `uploaded ${file.name} (${(file.size / 1024).toFixed(0)} KB)`,
      latency_ms: 0,
    };
  }
}

export const IMAGE_EDIT_PROVIDERS: Record<ImageEditProviderId, ImageEditProvider> = {
  sandbox: new SandboxImageProvider(),
  gemini: new GeminiImageProvider(),
  upload: new UploadImageProvider(),
};

export const uploadImages = IMAGE_EDIT_PROVIDERS.upload as UploadImageProvider;

/* =============================== VOICE ======================== */

export interface UserAudioResult {
  url: string;
  duration: number;
  label: string;
  mime: string;
  bytes: number;
}

export class UserVoiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Measure a real audio file/blob — the timeline needs the true length. */
export function measureAudio(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = "metadata";
    const done = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) resolve(+a.duration.toFixed(3));
      else reject(new UserVoiceError("UNREADABLE_AUDIO", "Could not read the audio duration."));
    };
    a.onloadedmetadata = done;
    a.ondurationchange = () => {
      if (Number.isFinite(a.duration) && a.duration > 0 && a.duration !== Infinity) done();
    };
    a.onerror = () => reject(new UserVoiceError("UNREADABLE_AUDIO", "This file could not be decoded as audio."));
    a.src = url;
  });
}

/** Upload provider — the user's own recorded file. */
export async function voiceFromFile(file: File): Promise<UserAudioResult> {
  if (!file.type.startsWith("audio/")) {
    throw new UserVoiceError("INVALID_MIME", `"${file.type || "unknown"}" is not an audio file.`);
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new UserVoiceError("FILE_TOO_LARGE", "Audio uploads are limited to 25 MB.");
  }
  const url = URL.createObjectURL(file);
  const duration = await measureAudio(url);
  return { url, duration, label: file.name, mime: file.type, bytes: file.size };
}

/** Record provider — microphone capture via MediaRecorder. */
export class VoiceRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;
  private startedAt = 0;

  get recording(): boolean {
    return this.rec?.state === "recording";
  }

  async start(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new UserVoiceError("NO_MICROPHONE_API", "This browser exposes no microphone API.");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      throw new UserVoiceError("MIC_DENIED", "Microphone permission was denied.");
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
    );
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(120);
    this.startedAt = performance.now();
  }

  async stop(): Promise<UserAudioResult> {
    const rec = this.rec;
    if (!rec) throw new UserVoiceError("NOT_RECORDING", "No recording in progress.");
    const wall = (performance.now() - this.startedAt) / 1000;

    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;

    const url = URL.createObjectURL(blob);
    // webm/opus from MediaRecorder often reports Infinity duration;
    // fall back to the measured wall-clock length of the take.
    let duration: number;
    try {
      duration = await measureAudio(url);
    } catch {
      duration = +wall.toFixed(3);
    }
    if (!Number.isFinite(duration) || duration <= 0) duration = +wall.toFixed(3);

    return { url, duration, label: "recorded take", mime: blob.type, bytes: blob.size };
  }

  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

export const recorder = new VoiceRecorder();

/** Play any user/AI audio asset through a plain element (preview). */
let previewEl: HTMLAudioElement | null = null;
export function previewAudio(url: string, gain = 1, speed = 1): HTMLAudioElement {
  stopPreview();
  previewEl = new Audio(url);
  previewEl.volume = Math.max(0, Math.min(1, gain));
  previewEl.playbackRate = Math.max(0.5, Math.min(2, speed));
  void previewEl.play().catch(() => undefined);
  return previewEl;
}
export function stopPreview() {
  if (previewEl) {
    previewEl.pause();
    previewEl = null;
  }
}

