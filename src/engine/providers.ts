/* ============================================================
   BRYME ENGINE — provider-agnostic render layer
   Adapters declare capabilities honestly; the engine selects
   a provider, never pretends an unavailable one succeeded.
   ============================================================ */

export type ProviderId = "sandbox" | "openai" | "stability" | "flux";

export interface ProviderCapabilities {
  reference_images: boolean;
  negative_prompt: boolean;
  seed: boolean;
  max_batch: number;
  configured: boolean; // server credential present?
}

export interface NormalizedError {
  code:
    | "PROVIDER_NOT_CONFIGURED"
    | "PROVIDER_AUTH"
    | "PROVIDER_RATE_LIMIT"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_INVALID_PROMPT"
    | "PROVIDER_INVALID_IMAGE"
    | "CAPABILITY_UNSUPPORTED"
    | "STORAGE_FAILURE"
    | "GENERATION_FAILED";
  message: string;
  retryable: boolean;
}

export class EngineError extends Error {
  payload: NormalizedError;
  constructor(e: NormalizedError) {
    super(e.message);
    this.payload = e;
  }
}

export interface RenderJob {
  id: string;
  prompt: string;
  negative_prompt: string;
  aspect_ratio: string;
  reference_images: string[];
  seed?: number | null;
  panel_key: string; // maps to a rendered frame in the demo renderer
  attempt?: number;
  variant?: number;  // regeneration index — picks a fresh take
}

export interface RenderOutput {
  image_bytes_url: string; // resolved storage URL (post-persistence)
  seed: number;
  latency_ms: number;
  provider_meta: Record<string, string>;
}

export interface ImageProvider {
  id: ProviderId;
  label: string;
  model: string;
  notes: string;
  capabilities: ProviderCapabilities;
  generate(job: RenderJob, onProgress?: (pct: number) => void): Promise<RenderOutput>;
}

/* -------------------------------------------------- sandbox ----
   Deterministic in-cluster renderer used for development, CI and
   this control room. Returns frames pre-rendered by the pipeline;
   simulates provider latency and one transient 429 so the retry
   path is exercised by the demo flow.
------------------------------------------------------------------ */

const FRAME_MAP: Record<string, string[]> = {
  "panel-20": ["/panels/panel-20-winner.jpg", "/panels/panel-20-winner-v2.jpg"],
  "panel-07": ["/panels/panel-07-penalty-save.jpg"],
  "panel-12": ["/panels/panel-12-var.jpg"],
  "panel-01": ["/panels/panel-01-kickoff.jpg"],
  "panel-21": ["/panels/panel-21-crowd.jpg"],
};
const FALLBACK = [
  "/panels/panel-20-winner.jpg",
  "/panels/panel-07-penalty-save.jpg",
  "/panels/panel-12-var.jpg",
  "/panels/panel-20-winner-v2.jpg",
];

export class SandboxProvider implements ImageProvider {
  id = "sandbox" as const;
  label = "Sandbox Mock";
  model = "bryme/mock-renderer-1";
  notes = "Deterministic renderer for dev & CI. Zero cost, zero external calls.";
  private transient429Consumed = new Set<string>();

  capabilities: ProviderCapabilities = {
    reference_images: true,
    negative_prompt: true,
    seed: true,
    max_batch: 4,
    configured: true,
  };

  async generate(job: RenderJob, onProgress?: (pct: number) => void): Promise<RenderOutput> {
    const t0 = performance.now();

    // one deterministic transient rate-limit per panel so the
    // queue's retry/backoff path is visible in the demo
    if (!this.transient429Consumed.has(job.panel_key) && (job.attempt ?? 1) === 1) {
      this.transient429Consumed.add(job.panel_key);
      await sleep(900 + Math.random() * 500);
      throw new EngineError({
        code: "PROVIDER_RATE_LIMIT",
        message: "sandbox: simulated 429 — engine will back off and retry automatically.",
        retryable: true,
      });
    }

    const steps = 26;
    for (let i = 1; i <= steps; i++) {
      await sleep(70 + Math.random() * 110);
      onProgress?.(Math.round((i / steps) * 100));
      if (Math.random() < 0.012) {
        throw new EngineError({
          code: "PROVIDER_TIMEOUT",
          message: "sandbox: render worker timed out mid-frame.",
          retryable: true,
        });
      }
    }

    const frames = FRAME_MAP[job.panel_key] ?? FALLBACK;
    const idx = (job.variant ?? 0) % frames.length;
    const seed = stableSeed(job.prompt + String(job.variant ?? 0));
    return {
      image_bytes_url: frames[idx],
      seed,
      latency_ms: Math.round(performance.now() - t0),
      provider_meta: { renderer: this.model, panel: job.panel_key, variant: String(job.variant ?? 0) },
    };
  }
}

/* -------------------------------------------- real adapters ----
   Configured=false in this control room (credentials live on the
   server). They fail loudly and clearly — never a fake success.
   Full HTTP implementations ship in the FastAPI bundle (/Source).
------------------------------------------------------------------ */

function unavailable(id: ProviderId, label: string, model: string, caps: Partial<ProviderCapabilities>): ImageProvider {
  return {
    id,
    label,
    model,
    notes: "Server-side adapter — full implementation in the shipped FastAPI bundle.",
    capabilities: {
      reference_images: false,
      negative_prompt: true,
      seed: false,
      max_batch: 1,
      configured: false,
      ...caps,
    },
    async generate() {
      throw new EngineError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: `${label} adapter is registered but no API key is configured for this environment. Set its credential in .env on the server, or select the sandbox provider.`,
        retryable: false,
      });
    },
  };
}

const openai = unavailable("openai", "OpenAI Images", "gpt-image-1", {
  reference_images: true, // via images/edits with image conditioning
  negative_prompt: false, // not supported — engine rewrites restrictions inline
});
const stability = unavailable("stability", "Stability AI", "sd3.5-large", {
  reference_images: false,
  negative_prompt: true,
});
const flux = unavailable("flux", "Black Forest Labs", "flux-pro-1.1", {
  reference_images: false,
  negative_prompt: false,
  seed: true,
});

export const PROVIDERS: Record<ProviderId, ImageProvider> = {
  sandbox: new SandboxProvider(),
  openai,
  stability,
  flux,
};

export function getProvider(id: ProviderId): ImageProvider {
  const p = PROVIDERS[id];
  if (!p) {
    throw new EngineError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: `No adapter registered for provider "${id}".`,
      retryable: false,
    });
  }
  return p;
}

/* -------------------------------------------------- helpers ---- */

export function capabilityWarnings(provider: ImageProvider, job: { reference_images: string[]; seed?: number | null }): string[] {
  const w: string[] = [];
  if (job.reference_images.length > 0 && !provider.capabilities.reference_images) {
    w.push(
      `CAPABILITY_WARNING: ${provider.id} does not accept reference images — continuity will rely on the character-bible text block only.`
    );
  }
  if (job.seed != null && !provider.capabilities.seed) {
    w.push(`CAPABILITY_WARNING: ${provider.id} does not expose a seed parameter — the seed was dropped from the request.`);
  }
  return w;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function stableSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

