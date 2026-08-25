import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Braces,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleDashed,
  Layers,
  ListPlus,
  Lock,
  Loader2,
  RefreshCw,
  ScanFace,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { BIBLES } from "../engine/core";
import { PROJECT, engine, useJobs, usePanels } from "../engine/runtime";
import { PROVIDERS, type ProviderId } from "../engine/providers";
import { Card, CardHeader, Chip, CopyButton, JsonBlock, StatusBadge } from "./ui";

const LAYER_COLORS: Record<string, string> = {
  style: "text-violet", characters: "text-city", teams: "text-gold",
  scene: "text-fairway", event: "text-ember", camera: "text-violet",
  environment: "text-fairway", dialogue: "text-gold", continuity: "text-city",
  originality: "text-claret",
};

const PHASES = ["validate", "compose", "adapt", "render", "store", "index"] as const;

function PhaseRail({ job }: { job?: ReturnType<typeof useJobs>[number] }) {
  const activeIdx = job ? PHASES.indexOf(job.phase) : -1;
  const done = job?.status === "completed";
  const failed = job?.status === "failed";
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => {
        const state = done || i < activeIdx ? "done" : failed && i > activeIdx ? "idle" : i === activeIdx ? (failed ? "fail" : "active") : "idle";
        return (
          <div key={p} className="flex flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              {state === "done" ? (
                <CheckCircle2 size={13} className="shrink-0 text-fairway" />
              ) : state === "active" ? (
                <Loader2 size={13} className="shrink-0 animate-spin text-city" />
              ) : state === "fail" ? (
                <CircleAlert size={13} className="shrink-0 text-claret" />
              ) : (
                <Circle size={13} className="shrink-0 text-faint/50" />
              )}
              <span className={`h-px flex-1 ${state === "done" ? "bg-fairway/50" : "bg-white/[0.07]"}`} />
            </div>
            <span className={`font-mono text-[8.5px] uppercase tracking-[0.18em] ${state === "active" ? "text-city" : state === "done" ? "text-fairway/80" : state === "fail" ? "text-claret/80" : "text-faint/60"}`}>
              {p}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DialogueHighlight({ text }: { text: string }) {
  const parts = text.split(/("[^"]*")/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('"') ? (
          <span key={i} className="text-gold">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export default function Console() {
  const panels = usePanels();
  const jobs = useJobs();
  const [panelId, setPanelId] = useState("panel-20");
  const [providerId, setProviderId] = useState<ProviderId>("sandbox");
  const [openLayers, setOpenLayers] = useState<Set<string>>(new Set(["style", "characters", "event", "dialogue"]));

  const panel = panels.find((p) => p.id === panelId) ?? panels[0];
  const job = jobs.find((j) => j.panel_id === panel.id);
  const running = job && ["queued", "processing", "retrying"].includes(job.status);
  const provider = PROVIDERS[providerId];

  const composed = useMemo(() => engine.composeForPanel(panel), [panel]);

  const toggleLayer = (key: string) =>
    setOpenLayers((s) => {
      const next = new Set(s);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const draftIds = panels.filter((p) => p.status === "draft").map((p) => p.id);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* ============================== LEFT: panels + providers ==== */}
      <div className="space-y-4 xl:col-span-3">
        <Card>
          <CardHeader title="Panel Queue" mono={PROJECT.id} />
          <div className="divide-y divide-white/[0.04]">
            {panels.map((p) => {
              const active = p.id === panel.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setPanelId(p.id)}
                  className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${active ? "bg-city/[0.06]" : "hover:bg-white/[0.02]"}`}
                >
                  <span className={`mt-0.5 font-mono text-[11px] font-bold ${active ? "text-city" : "text-faint"}`}>
                    P{String(p.number).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-semibold ${active ? "text-bone" : "text-bone/75"}`}>
                      {p.title}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      {p.event && (
                        <Chip tone="border-ember/30 bg-ember/[0.07] text-ember/90">
                          {p.event.minute}′ {p.event.type}
                        </Chip>
                      )}
                      <StatusBadge status={p.status} />
                    </span>
                  </span>
                  {p.image_url && (
                    <img src={p.image_url} alt="" className="h-10 w-16 shrink-0 rounded-md border border-white/10 object-cover" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-line p-3">
            <button
              onClick={() => draftIds.length && engine.batch(draftIds, providerId)}
              disabled={draftIds.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10.5px] tracking-[0.15em] text-dim transition-colors hover:border-fairway/40 hover:text-fairway disabled:opacity-40"
            >
              <ListPlus size={13} />
              POST /generations/batch · {draftIds.length} DRAFT PANELS
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Render Provider" mono="adapters: 4" />
          <div className="space-y-1.5 p-3">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
              const p = PROVIDERS[id];
              const active = id === providerId;
              return (
                <button
                  key={id}
                  onClick={() => setProviderId(id)}
                  className={`w-full rounded-lg border p-3 text-left transition-all ${
                    active ? "border-city/50 bg-city/[0.07]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-bone">
                      {p.label}
                      {!p.capabilities.configured && <Lock size={11} className="text-gold/80" />}
                    </span>
                    <span className={`font-mono text-[9.5px] uppercase tracking-[0.2em] ${p.capabilities.configured ? "text-fairway" : "text-gold/80"}`}>
                      {p.capabilities.configured ? "configured" : "no key"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-faint">{p.model}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Cap ok={p.capabilities.reference_images} label="ref-img" />
                    <Cap ok={p.capabilities.negative_prompt} label="neg-prompt" />
                    <Cap ok={p.capabilities.seed} label="seed" />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ============================ MIDDLE: prompt composer ======= */}
      <div className="space-y-4 xl:col-span-5">
        <Card>
          <CardHeader
            title="Prompt Composer"
            mono="POST /api/v1/prompts/preview"
            right={<CopyButton text={composed.prompt} label="prompt" />}
          />
          <div className="divide-y divide-white/[0.04]">
            {composed.layers.map((layer, i) => {
              const open = openLayers.has(layer.key);
              return (
                <div key={layer.key}>
                  <button onClick={() => toggleLayer(layer.key)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02]">
                    <span className={`font-mono text-[10px] font-bold ${LAYER_COLORS[layer.key]}`}>{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-bone/70">{layer.label}</span>
                    <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
                      <ChevronDown size={13} className="text-faint" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="mx-4 mb-3 rounded-lg border border-white/[0.06] bg-black/30 p-3 font-mono text-[10.5px] leading-relaxed text-dim">
                          <DialogueHighlight text={layer.content} />
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Composed Prompt" mono={`${composed.prompt.length} chars`} right={<Braces size={13} className="text-faint" />} />
          <div className="max-h-56 overflow-y-auto p-4 code-scroll">
            <p className="font-mono text-[11px] leading-[1.85] text-bone/80">
              <DialogueHighlight text={composed.prompt} />
            </p>
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-claret/80">Negative block · auto-injected</span>
              <CopyButton text={composed.negative_prompt} label="neg" />
            </div>
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto code-scroll">
              {composed.negative_prompt.split(", ").map((n) => (
                <span key={n} className="rounded border border-claret/20 bg-claret/[0.06] px-1.5 py-0.5 font-mono text-[9.5px] text-claret/70">
                  {n}
                </span>
              ))}
            </div>
          </div>
          {composed.warnings.length > 0 && (
            <div className="border-t border-line px-4 py-2.5">
              {composed.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 font-mono text-[10px] leading-relaxed text-gold/90">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ============================ RIGHT: render monitor ========= */}
      <div className="space-y-4 xl:col-span-4">
        <Card className="overflow-hidden">
          <CardHeader
            title="Render Monitor"
            mono={job ? job.id : "idle"}
            right={job && <StatusBadge status={job.status} />}
          />
          <div className="space-y-4 p-4">
            <PhaseRail job={job} />

            {/* progress + attempts */}
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className={`h-full rounded-full ${job?.status === "failed" ? "bg-claret" : "bg-gradient-to-r from-city to-fairway"}`}
                  animate={{ width: job ? `${job.status === "completed" ? 100 : job.progress}%` : "0%" }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <span className="font-mono text-[10px] text-dim">{job ? `${job.status === "completed" ? 100 : job.progress}%` : "--"}</span>
              {job && (
                <Chip tone="border-white/10 bg-white/[0.03] text-dim">
                  attempt {job.attempt_count}/3
                </Chip>
              )}
            </div>

            {job?.status === "retrying" && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 rounded-lg border border-gold/25 bg-gold/[0.06] px-3 py-2 font-mono text-[10.5px] text-gold">
                <RefreshCw size={12} className="animate-spin" style={{ animationDuration: "2.5s" }} />
                {job.error?.code} — exponential backoff, retry {job.attempt_count}/3 incoming
              </motion.p>
            )}

            {/* image stage */}
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[0.08] bg-black/40">
              <AnimatePresence mode="wait">
                {running ? (
                  <motion.div key="rendering" className="absolute inset-0" exit={{ opacity: 0 }}>
                    {job?.image_url ? (
                      <img src={job.image_url} alt="" className="h-full w-full object-cover opacity-20 blur-md" />
                    ) : (
                      <div className="pitch-stripes absolute inset-0 opacity-60" />
                    )}
                    <div className="render-scan" />
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="text-center">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-city" />
                        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/70">
                          {job?.phase === "render" ? `rasterizing frame · ${job.progress}%` : `${job?.phase} context…`}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : job?.status === "completed" && job.image_url ? (
                  <motion.img
                    key={job.image_url + job.id}
                    src={job.image_url}
                    alt={panel.title}
                    initial={{ opacity: 0, scale: 1.04, filter: "blur(14px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full w-full object-cover"
                  />
                ) : job?.status === "failed" ? (
                  <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 grid place-items-center p-4">
                    <div className="w-full max-w-sm">
                      <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-claret">
                        <CircleAlert size={13} /> normalized provider error
                      </p>
                      <JsonBlock data={{ error: job.error }} className="rounded-lg border border-claret/20 bg-claret/[0.04] p-3" />
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="idle" className="absolute inset-0 grid place-items-center" exit={{ opacity: 0 }}>
                    <div className="text-center">
                      <ScanFace className="mx-auto mb-3 h-7 w-7 text-faint/60" />
                      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-faint">awaiting render instruction</p>
                      <p className="mt-1 font-mono text-[9.5px] text-faint/60">canvas {panel.aspect_ratio} · provider {providerId}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {job?.status === "completed" && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="absolute bottom-2 left-2 flex gap-1.5">
                  <Chip tone="border-black/40 bg-black/60 text-fairway backdrop-blur-sm">{job.latency_ms}ms</Chip>
                  {job.seed != null && <Chip tone="border-black/40 bg-black/60 text-city backdrop-blur-sm">seed {job.seed}</Chip>}
                </motion.div>
              )}
            </div>

            {/* actions */}
            <div className="flex gap-2">
              <button
                onClick={() => engine.generate(panel.id, providerId)}
                disabled={!!running}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-fairway px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                <Zap size={14} strokeWidth={2.5} />
                {running ? "rendering…" : "Generate panel"}
              </button>
              <button
                onClick={() => job && engine.regenerate(job.id, { seed: provider.capabilities.seed ? Math.floor(Math.random() * 1e9) : null })}
                disabled={!job || job.status !== "completed"}
                title="POST /api/v1/generations/{id}/regenerate"
                className="flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.04] px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] text-bone/80 transition-colors hover:border-city/50 hover:text-city disabled:opacity-40"
              >
                <RefreshCw size={13} />
                Re-roll
              </button>
            </div>

            {/* metadata */}
            {job && (
              <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3.5 py-2.5">
                <div className="grid grid-cols-2 gap-x-4">
                  <MetaKV k="generation_id" v={job.id} />
                  <MetaKV k="provider" v={`${job.provider}`} />
                  <MetaKV k="attempts" v={String(job.attempt_count)} />
                  <MetaKV k="seed" v={job.seed != null ? String(job.seed) : "—"} />
                  <MetaKV k="latency" v={job.latency_ms ? `${job.latency_ms} ms` : "—"} />
                  <MetaKV k="references" v={`${job.reference_images.length} attached`} />
                </div>
              </div>
            )}

            {job && job.warnings.length > 0 && (
              <div className="rounded-lg border border-gold/20 bg-gold/[0.04] px-3.5 py-2.5">
                {job.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 py-0.5 font-mono text-[9.5px] leading-relaxed text-gold/85">
                    <TriangleAlert size={11} className="mt-0.5 shrink-0" />
                    {w}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Continuity Chain" mono="panel-over-panel" right={<Layers size={13} className="text-faint" />} />
          <div className="space-y-2 p-4">
            {composed.continuity.length > 0 ? (
              composed.continuity.map((c) => (
                <p key={c} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] leading-relaxed text-dim">
                  {c}
                </p>
              ))
            ) : (
              <p className="font-mono text-[10px] text-faint">first panel in sequence — no prior frames</p>
            )}
            <p className="flex items-start gap-2 pt-1 font-mono text-[9.5px] leading-relaxed text-faint">
              <CircleDashed size={12} className="mt-0.5 shrink-0 text-city/70" />
              Character A in panel {panel.number} equals Character A in every earlier panel — anchored by bible text
              {provider.capabilities.reference_images ? " + reference image conditioning." : " only (adapter has no ref-image channel)."}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Cap({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.15em] ${ok ? "bg-fairway/[0.08] text-fairway/80" : "bg-white/[0.03] text-faint/70 line-through"}`}>
      {label}
    </span>
  );
}

function MetaKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-white/[0.04] py-1.5 last:border-none">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">{k}</div>
      <div className="truncate font-mono text-[11px] text-bone/85">{v}</div>
    </div>
  );
}

/* bible re-export convenience for other views */
export { BIBLES };

