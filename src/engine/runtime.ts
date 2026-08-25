/* ============================================================
   BRYME ENGINE — generation runtime
   Job queue (concurrency-limited, retrying), generation history,
   continuity tracking, regeneration. Mirrors workers/queue.py
   + services/generation_service.py in the shipped backend.
   ============================================================ */

import { useSyncExternalStore } from "react";
import {
  BIBLES,
  CharacterBible,
  ComposedPrompt,
  DialogueEntry,
  MatchEvent,
  PanelSpec,
  STYLE_FOOTBALL_V1,
  TEAM_BOURNEMOUTH,
  TEAM_CITY,
  composePrompt,
  type AspectRatio,
} from "./core";
import {
  EngineError,
  NormalizedError,
  ProviderId,
  capabilityWarnings,
  getProvider,
  sleep,
  stableSeed,
} from "./providers";

export type JobStatus = "queued" | "processing" | "retrying" | "completed" | "failed" | "cancelled";

export type JobPhase = "validate" | "compose" | "adapt" | "render" | "store" | "index";

export interface GenerationJob {
  id: string;
  project_id: string;
  panel_id: string;
  provider: ProviderId;
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  attempt_count: number;
  prompt: string;
  negative_prompt: string;
  composed?: ComposedPrompt;
  reference_images: string[];
  warnings: string[];
  seed?: number | null;
  image_url?: string;
  error?: NormalizedError;
  latency_ms?: number;
  created_at: string;
  completed_at?: string;
  variant: number;
}

export interface Project {
  id: string;
  name: string;
  match: string;
  scoreline: string;
  style_id: string;
  team_ids: string[];
  character_ids: string[];
  panels: PanelSpec[];
}

export const MAX_RETRIES = 3;
export const CONCURRENCY = 2;

/* ------------------------------------------------ seed project ---- */

export const PROJECT: Project = {
  id: "proj-city-bou",
  name: "Manchester City vs Bournemouth",
  match: "Premier League — Matchday 12",
  scoreline: "1–0 · 90+1'",
  style_id: STYLE_FOOTBALL_V1.id,
  team_ids: [TEAM_CITY.id, TEAM_BOURNEMOUTH.id],
  character_ids: BIBLES.characters.map((c) => c.id),
  panels: [
    {
      id: "panel-01", number: 1, title: "Coin Toss Theatre",
      scene: "pre-match coin toss under a wall of floodlights, both captains leaning in, the away end a red-and-black mosaic",
      event: { minute: "0", type: "kickoff", team: "Manchester City" },
      dialogue: [
        { speaker: "Narrator", text: "Ninety minutes. Two teams. One storyline.", kind: "narration" },
        { speaker: "City Captain", text: "Make we just start this thing abeg.", kind: "speech", language: "Nigerian Pidgin" },
        { speaker: "Keeper", text: "You go try. You no go score today.", kind: "speech" },
        { speaker: "City Midfielder", text: "Relax my guy. Today na our day.", kind: "speech", language: "Nigerian Pidgin" },
      ],
      character_ids: ["city-creative-midfielder", "bou-keeper-01"],
      aspect_ratio: "16:9", status: "completed",
      image_url: "/panels/panel-01-kickoff.jpg", last_generation_id: "gen_9001aa",
    },
    {
      id: "panel-07", number: 7, title: "The Save of His Life",
      scene: "a stonewall penalty in the 34th minute — and the keeper goes full horizontal to claw it out of the bottom corner",
      event: { minute: "34", type: "save", team: "Bournemouth", player: "Shot-Stopper Keeper" },
      dialogue: [
        { speaker: "Keeper", text: "NOT TODAY! You hear me?! NOT TODAY!", kind: "speech" },
        { speaker: "City Midfielder", text: "Ah! How this man take reach there?!", kind: "speech", language: "Nigerian Pidgin" },
        { speaker: "Commentator", text: "That is simply outrageous goalkeeping.", kind: "commentary" },
        { speaker: "Crowd", text: "KEEPER! KEEPER!", kind: "crowd" },
      ],
      character_ids: ["bou-keeper-01", "city-creative-midfielder"],
      aspect_ratio: "16:9", status: "completed",
      image_url: "/panels/panel-07-penalty-save.jpg", last_generation_id: "gen_a104c2",
    },
    {
      id: "panel-12", number: 12, title: "VAR Kwaranta",
      scene: "a handball shout, a finger to the earpiece, and twenty-two players losing their minds at once",
      event: { minute: "58", type: "var", team: "Manchester City", player: "Creative Midfielder" },
      dialogue: [
        { speaker: "City Midfielder", text: "Ref abeg, na handball! Everybody see am!", kind: "speech", language: "Nigerian Pidgin" },
        { speaker: "Keeper", text: "You dey dream. Play on!", kind: "speech" },
        { speaker: "Crowd", text: "V! A! R! V! A! R!", kind: "crowd" },
        { speaker: "Commentator", text: "The earpiece is buzzing. The whole stadium has lost its mind.", kind: "commentary" },
      ],
      character_ids: ["city-creative-midfielder", "bou-keeper-01"],
      aspect_ratio: "16:9", status: "completed",
      image_url: "/panels/panel-12-var.jpg", last_generation_id: "gen_c31f7a",
    },
    {
      id: "panel-20", number: 20, title: "90+1 — The Winner",
      scene: "stoppage-time winner — a corner whipped in, the towering centre-back arrives unmarked and detonates a volley into the top corner",
      event: { minute: "90+1", type: "goal", team: "Manchester City", player: "Towering Centre-Back", assist: "Creative Midfielder", detail: "top corner" },
      dialogue: [
        { speaker: "City Player", text: "Omo, we don win am!", kind: "speech", language: "Nigerian Pidgin" },
        { speaker: "Commentator", text: "At the DEATH! The champions-elect! Unbelievable scenes!", kind: "commentary" },
      ],
      character_ids: ["city-defender-01", "city-creative-midfielder", "bou-keeper-01"],
      aspect_ratio: "16:9", status: "draft",
    },
    {
      id: "panel-21", number: 21, title: "Limbs in the Away End",
      scene: "the away end detonates — strangers on strangers' shoulders, scarves everywhere, one steward quietly smiling",
      event: { minute: "90+2", type: "crowd_reaction", team: "Manchester City" },
      dialogue: [
        { speaker: "Crowd", text: "WE GO WIN AM! WE GO WIN AM!", kind: "crowd", language: "Nigerian Pidgin" },
        { speaker: "Narrator", text: "Limbs. Scarves. Strangers hugging strangers.", kind: "narration" },
        { speaker: "City Captain", text: "This one na for the fans. Una too much.", kind: "speech", language: "Nigerian Pidgin" },
      ],
      character_ids: [],
      aspect_ratio: "16:9", status: "completed",
      image_url: "/panels/panel-21-crowd.jpg", last_generation_id: "gen_9021cc",
    },
  ],
};

/* ------------------------------------------------------- store ---- */

interface EngineState {
  jobs: GenerationJob[];
  panels: Record<string, PanelSpec>;
}

type Listener = () => void;

class EngineRuntime {
  private state: EngineState;
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private active = 0;
  private variants: Record<string, number> = {};

  constructor() {
    const panels: Record<string, PanelSpec> = {};
    for (const p of PROJECT.panels) panels[p.id] = { ...p };

    const now = Date.now();
    const p7 = panels["panel-07"];
    const composed7 = this.composeForPanel(p7);
    const jobs: GenerationJob[] = [
      {
        id: "gen_a104c2",
        project_id: PROJECT.id,
        panel_id: "panel-07",
        provider: "sandbox",
        status: "completed",
        phase: "index",
        progress: 100,
        attempt_count: 1,
        prompt: composed7.prompt,
        negative_prompt: composed7.negative_prompt,
        composed: composed7,
        reference_images: ["characters/midfielder-sheet.jpg"],
        warnings: [],
        seed: stableSeed(composed7.prompt),
        image_url: "/panels/panel-07-penalty-save.jpg",
        latency_ms: 3812,
        created_at: new Date(now - 1000 * 60 * 42).toISOString(),
        completed_at: new Date(now - 1000 * 60 * 42 + 3812).toISOString(),
        variant: 0,
      },
      ...(["panel-01", "panel-12", "panel-21"] as const).map((pid, i) => {
        const c = this.composeForPanel(panels[pid]);
        const ids: Record<string, string> = { "panel-01": "gen_9001aa", "panel-12": "gen_c31f7a", "panel-21": "gen_9021cc" };
        return {
          id: ids[pid],
          project_id: PROJECT.id,
          panel_id: pid,
          provider: "sandbox" as const,
          status: "completed" as const,
          phase: "index" as const,
          progress: 100,
          attempt_count: pid === "panel-12" ? 2 : 1,
          prompt: c.prompt,
          negative_prompt: c.negative_prompt,
          composed: c,
          reference_images: [],
          warnings: [],
          seed: stableSeed(c.prompt),
          image_url: panels[pid].image_url,
          latency_ms: 3200 + i * 410,
          created_at: new Date(now - 1000 * 60 * (60 - i * 6)).toISOString(),
          completed_at: new Date(now - 1000 * 60 * (60 - i * 6) + 3400).toISOString(),
          variant: 0,
        };
      }),
      {
        id: "gen_b77e09",
        project_id: PROJECT.id,
        panel_id: "panel-12",
        provider: "openai",
        status: "failed",
        phase: "render",
        progress: 0,
        attempt_count: 3,
        prompt: this.composeForPanel(panels["panel-12"]).prompt,
        negative_prompt: this.composeForPanel(panels["panel-12"]).negative_prompt,
        composed: this.composeForPanel(panels["panel-12"]),
        reference_images: [],
        warnings: [],
        error: {
          code: "PROVIDER_TIMEOUT",
          message: "Deadline exceeded after 120s waiting on provider stream. Attempt 3/3 exhausted.",
          retryable: true,
        },
        created_at: new Date(now - 1000 * 60 * 17).toISOString(),
        completed_at: new Date(now - 1000 * 60 * 11).toISOString(),
        variant: 0,
      },
    ];

    this.state = { jobs, panels };
  }

  /* ---------- subscription ---------- */
  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  getState = () => this.state;

  private patchJob(id: string, patch: Partial<GenerationJob>) {
    this.state = {
      ...this.state,
      jobs: this.state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    };
    this.emit();
  }
  private patchPanel(id: string, patch: Partial<PanelSpec>) {
    this.state = {
      ...this.state,
      panels: { ...this.state.panels, [id]: { ...this.state.panels[id], ...patch } },
    };
  }
  private addJob(job: GenerationJob) {
    this.state = { ...this.state, jobs: [job, ...this.state.jobs] };
    this.emit();
  }

  /* ---------- prompt preview (POST /api/v1/prompts/preview) ---------- */
  composeForPanel(panel: PanelSpec, mods?: { prompt_override?: string; style_override?: string }): ComposedPrompt {
    const characters = panel.character_ids
      .map((id) => BIBLES.characters.find((c) => c.id === id))
      .filter(Boolean) as CharacterBible[];
    const style = BIBLES.styles.find((s) => s.id === (mods?.style_override ?? PROJECT.style_id)) ?? STYLE_FOOTBALL_V1;
    const teams = panel.character_ids.length
      ? characters.map((c) => BIBLES.teams.find((t) => t.id === c.team_id)!).filter(Boolean)
      : BIBLES.teams;

    const idx = PROJECT.panels.findIndex((p) => p.id === panel.id);
    const continuity = idx > 0
      ? [`previously — panel ${PROJECT.panels[idx - 1].number}: "${PROJECT.panels[idx - 1].scene}"`]
      : [];

    const composed = composePrompt({
      style, characters, teams,
      scene: panel.scene,
      event: panel.event,
      dialogue: panel.dialogue,
      camera: panel.camera,
      environment: panel.environment,
      continuity,
    });
    if (mods?.prompt_override) composed.prompt = mods.prompt_override;
    return composed;
  }

  /* ---------- generation ---------- */
  generate(panelId: string, providerId: ProviderId, mods?: { prompt_override?: string; seed?: number | null; force_first_try?: boolean }): string {
    const panel = this.state.panels[panelId];
    const provider = getProvider(providerId);
    const composed = this.composeForPanel(panel, mods);

    const variant = this.variants[panelId] ?? 0;
    const seed = mods?.seed !== undefined ? mods.seed : null;
    const reference_images = panel.character_ids
      .flatMap((cid) => BIBLES.characters.find((c) => c.id === cid)?.reference_images ?? [])
      .slice(0, 3);
    const warnings = [...composed.warnings, ...capabilityWarnings(provider, { reference_images, seed })];

    const job: GenerationJob = {
      id: `gen_${Math.random().toString(16).slice(2, 8)}`,
      project_id: PROJECT.id,
      panel_id: panelId,
      provider: providerId,
      status: "queued",
      phase: "validate",
      progress: 0,
      attempt_count: 0,
      prompt: composed.prompt,
      negative_prompt: composed.negative_prompt,
      composed,
      reference_images,
      warnings,
      seed,
      created_at: new Date().toISOString(),
      variant,
    };
    this.variants[panelId] = variant + 1;
    this.addJob(job);
    this.patchPanel(panelId, { status: "queued", last_generation_id: job.id });
    this.queue.push(job.id);
    this.pump();
    return job.id;
  }

  regenerate(jobId: string, mods?: { prompt_override?: string; style_override?: string; seed?: number | null }): string {
    const original = this.state.jobs.find((j) => j.id === jobId);
    if (!original) throw new Error("Generation not found");
    const provider = getProvider(original.provider);
    if (mods?.seed != null && !provider.capabilities.seed) {
      throw new EngineError({
        code: "CAPABILITY_UNSUPPORTED",
        message: `${original.provider} does not expose a seed parameter — supply null or choose a seed-capable provider.`,
        retryable: false,
      });
    }
    return this.generate(original.panel_id, original.provider, {
      prompt_override: mods?.prompt_override,
      seed: mods?.seed ?? null,
      force_first_try: true,
    });
  }

  batch(panelIds: string[], providerId: ProviderId): string[] {
    return panelIds.map((id) => this.generate(id, providerId));
  }

  cancel(jobId: string) {
    this.queue = this.queue.filter((q) => q !== jobId);
    this.patchJob(jobId, { status: "cancelled", completed_at: new Date().toISOString() });
  }

  /* ---------- the queue worker ---------- */
  private pump() {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.active++;
      void this.runJob(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async runJob(id: string) {
    const job = this.state.jobs.find((j) => j.id === id);
    if (!job) return;
    const panel = this.state.panels[job.panel_id];
    const provider = getProvider(job.provider);

    const phase = async (p: JobPhase, ms: number) => {
      this.patchJob(id, { phase: p });
      await sleep(ms);
    };

    try {
      await phase("validate", 350);
      await phase("compose", 450);
      this.patchJob(id, { status: "processing", attempt_count: 1 });
      this.patchPanel(job.panel_id, { status: "processing" });
      await phase("adapt", 300);

      let attempt = 1;
      for (;;) {
        try {
          this.patchJob(id, { status: "processing", phase: "render", progress: 0 });
          const out = await provider.generate(
            {
              id: job.id,
              prompt: job.prompt,
              negative_prompt: job.negative_prompt,
              aspect_ratio: panel.aspect_ratio,
              reference_images: job.reference_images,
              seed: job.seed ?? undefined,
              panel_key: panel.id,
              attempt,
              variant: job.variant,
            },
            (pct) => this.patchJob(id, { progress: pct })
          );

          // storage abstraction: renderer URL persisted into object storage
          await phase("store", 420);
          const storedUrl = out.image_bytes_url; // local static bucket in this control room

          await phase("index", 260);
          this.patchJob(id, {
            status: "completed",
            progress: 100,
            attempt_count: attempt,
            image_url: storedUrl,
            seed: out.seed,
            latency_ms: out.latency_ms,
            completed_at: new Date().toISOString(),
          });
          this.patchPanel(job.panel_id, { status: "completed", image_url: storedUrl, last_generation_id: id });
          return;
        } catch (err) {
          const ne = toNormalized(err);
          if (ne.retryable && attempt < MAX_RETRIES && this.state.jobs.find((j) => j.id === id)?.status !== "cancelled") {
            attempt++;
            const backoff = 700 * Math.pow(2, attempt - 1) + Math.random() * 300;
            this.patchJob(id, {
              status: "retrying",
              attempt_count: attempt,
              error: ne,
              progress: 0,
            });
            await sleep(backoff);
            continue;
          }
          this.patchJob(id, {
            status: "failed",
            error: ne,
            attempt_count: attempt,
            completed_at: new Date().toISOString(),
          });
          this.patchPanel(job.panel_id, { status: "failed", last_generation_id: id });
          return;
        }
      }
    } catch (err) {
      this.patchJob(id, { status: "failed", error: toNormalized(err), completed_at: new Date().toISOString() });
      this.patchPanel(job.panel_id, { status: "failed", last_generation_id: id });
    }
  }
}

function toNormalized(err: unknown): NormalizedError {
  if (err instanceof EngineError) return err.payload;
  if (err instanceof Error) return { code: "GENERATION_FAILED", message: err.message, retryable: false };
  return { code: "GENERATION_FAILED", message: "Unknown failure", retryable: false };
}

export const engine = new EngineRuntime();

export function useJobs(): GenerationJob[] {
  return useSyncExternalStore(engine.subscribe, () => engine.getState().jobs);
}

/* panel list snapshot must be referentially stable between mutations,
   otherwise useSyncExternalStore re-renders forever */
let panelsCacheState: EngineState | null = null;
let panelsCache: PanelSpec[] = [];
function panelsSnapshot(): PanelSpec[] {
  const s = engine.getState();
  if (s !== panelsCacheState) {
    panelsCacheState = s;
    panelsCache = PROJECT.panels.map((p) => s.panels[p.id]);
  }
  return panelsCache;
}

export function usePanels(): PanelSpec[] {
  return useSyncExternalStore(engine.subscribe, panelsSnapshot);
}
export function usePanel(id: string): PanelSpec {
  return useSyncExternalStore(engine.subscribe, () => engine.getState().panels[id]);
}
export function useJob(id: string | null): GenerationJob | undefined {
  return useSyncExternalStore(engine.subscribe, () =>
    engine.getState().jobs.find((j) => j.id === id)
  );
}

/* helpers shared by views */
export function findCharacters(ids: string[]): CharacterBible[] {
  return ids.map((id) => BIBLES.characters.find((c) => c.id === id)!).filter(Boolean);
}
export function panelAspect(p: PanelSpec): AspectRatio {
  return p.aspect_ratio;
}
export type { MatchEvent, DialogueEntry };

