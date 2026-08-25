import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, RefreshCw, TriangleAlert, XCircle } from "lucide-react";
import { PROJECT, engine, useJobs, type GenerationJob } from "../engine/runtime";
import { PROVIDERS } from "../engine/providers";
import { Card, CardHeader, Chip, JsonBlock, StatusBadge } from "./ui";

const STATUS_FILTERS = ["all", "queued", "processing", "retrying", "completed", "failed", "cancelled"];

export default function Jobs() {
  const jobs = useJobs();
  const [status, setStatus] = useState("all");
  const [provider, setProvider] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      jobs.filter(
        (j) => (status === "all" || j.status === status) && (provider === "all" || j.provider === provider)
      ),
    [jobs, status, provider]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  return (
    <div>
      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
              status === s ? "border-fairway/50 bg-fairway/[0.08] text-fairway" : "border-white/10 text-dim hover:text-bone"
            }`}
          >
            {s}
            {s !== "all" && counts[s] ? <span className="ml-1 text-[9px] opacity-70">({counts[s]})</span> : null}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {["all", ...Object.keys(PROVIDERS)].map((p) => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.15em] transition-colors ${
              provider === p ? "border-city/50 bg-city/[0.08] text-city" : "border-white/10 text-dim hover:text-bone"
            }`}
          >
            {p}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-faint">
          GET /api/v1/generations?status={status}&provider={provider}
        </span>
      </div>

      {/* table */}
      <Card>
        <CardHeader title="Generation History" mono={`${filtered.length} records · ${PROJECT.name}`} />
        <div className="divide-y divide-white/[0.04]">
          <div className="hidden grid-cols-[110px_130px_90px_110px_70px_80px_1fr_24px] gap-3 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.2em] text-faint md:grid">
            <span>generation</span><span>panel</span><span>provider</span><span>status</span><span>tries</span><span>latency</span><span>created</span><span />
          </div>
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center font-mono text-[11px] text-faint">no generations match the active filters</p>
          )}
          {filtered.map((j) => (
            <JobRow key={j.id} job={j} open={openId === j.id} onToggle={() => setOpenId(openId === j.id ? null : j.id)} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function JobRow({ job, open, onToggle }: { job: GenerationJob; open: boolean; onToggle: () => void }) {
  const panel = PROJECT.panels.find((p) => p.id === job.panel_id);
  const running = ["queued", "processing", "retrying"].includes(job.status);
  return (
    <div>
      <button onClick={onToggle} className="grid w-full grid-cols-[1fr_24px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02] md:grid-cols-[110px_130px_90px_110px_70px_80px_1fr_24px]">
        <span className="truncate font-mono text-[11px] font-bold text-bone/85">{job.id}</span>
        <span className="hidden truncate font-mono text-[10.5px] text-dim md:block">
          P{String(panel?.number ?? 0).padStart(2, "0")} · {panel?.title ?? job.panel_id}
        </span>
        <span className="hidden font-mono text-[10.5px] text-city/90 md:block">{job.provider}</span>
        <span className="hidden md:block"><StatusBadge status={job.status} /></span>
        <span className="hidden font-mono text-[10.5px] text-dim md:block">{job.attempt_count}/3</span>
        <span className="hidden font-mono text-[10.5px] text-dim md:block">{job.latency_ms ? `${job.latency_ms}ms` : "—"}</span>
        <span className="hidden truncate font-mono text-[10px] text-faint md:block">
          {new Date(job.created_at).toLocaleTimeString()} · {job.prompt.slice(0, 72)}…
        </span>
        <div className="flex items-center justify-end md:hidden"><StatusBadge status={job.status} /></div>
        <motion.span animate={{ rotate: open ? 90 : 0 }} className="justify-self-end">
          <ChevronRight size={14} className="text-faint" />
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
            <div className="mx-4 mb-4 grid gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-4 lg:grid-cols-[200px_1fr_1fr]">
              {/* image */}
              <div className="aspect-video overflow-hidden rounded-lg border border-white/[0.08] bg-black/40">
                {job.image_url ? (
                  <img src={job.image_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center font-mono text-[9px] uppercase tracking-[0.25em] text-faint">
                    {job.status === "failed" ? "no frame persisted" : "rendering…"}
                  </div>
                )}
              </div>
              {/* prompt */}
              <div>
                <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-faint">final prompt</p>
                <p className="max-h-40 overflow-y-auto code-scroll rounded-md bg-black/30 p-2.5 font-mono text-[9.5px] leading-[1.7] text-dim">
                  {job.prompt}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {job.warnings.map((w) => (
                    <span key={w} className="flex items-center gap-1 rounded border border-gold/25 bg-gold/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-gold/85">
                      <TriangleAlert size={9} /> capability
                    </span>
                  ))}
                  {job.seed != null && <Chip>seed {job.seed}</Chip>}
                  {job.reference_images.length > 0 && <Chip>{job.reference_images.length} refs</Chip>}
                </div>
              </div>
              {/* error / actions */}
              <div className="flex flex-col gap-2">
                {job.error && <JsonBlock data={{ error: job.error }} className="rounded-md border border-claret/20 bg-claret/[0.04] p-2.5" />}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => engine.regenerate(job.id, {})}
                    className="flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-bone/80 transition-colors hover:border-city/50 hover:text-city"
                  >
                    <RefreshCw size={11} /> regenerate
                  </button>
                  {running && (
                    <button
                      onClick={() => engine.cancel(job.id)}
                      className="flex items-center gap-1.5 rounded-md border border-claret/30 bg-claret/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-claret transition-colors hover:bg-claret/[0.12]"
                    >
                      <XCircle size={11} /> cancel
                    </button>
                  )}
                  <span className="ml-auto self-end font-mono text-[9px] text-faint">
                    {job.completed_at ? `completed ${new Date(job.completed_at).toLocaleTimeString()}` : "in flight"}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

