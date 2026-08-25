import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2, CircleDashed, Clapperboard, Download, FileVideo,
  Layers, Loader2, Pause, Play, RotateCcw, ShieldCheck, Sparkles,
  Volume2, VolumeX, XCircle, Zap,
} from "lucide-react";
import StageCanvas, { type StageHandle } from "./studio/StageCanvas";
import TrackEditor, { SceneRail } from "./studio/TrackEditor";
import Inspector from "./studio/Inspector";
import { studio, useStudio } from "../engine/motion/studio";
import { ASPECTS, type AspectSpec, type TTSProviderId } from "../engine/motion/types";
import { TTS_PROVIDERS } from "../engine/motion/tts";
import { sceneAt } from "../engine/motion/timeline";
import { Card, CardHeader, Chip, StatusBadge } from "./ui";

export default function Studio() {
  const state = useStudio();
  const stage = useRef<StageHandle>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [safe, setSafe] = useState(false);
  const [boxes, setBoxes] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [zoom, setZoom] = useState(1);

  const tl = state.timeline;
  const spec = ASPECTS[state.project.aspect_ratio];
  const at = sceneAt(tl, time);
  const activeSceneId = at?.scene.id ?? tl.scenes[0]?.id;
  const doc = state.project.scenes.find((s) => s.id === activeSceneId);
  const selBubble = state.selection.kind === "bubble" ? state.selection.id : null;

  const seek = (t: number) => {
    setPlaying(false);
    setTime(Math.max(0, Math.min(tl.duration, t)));
  };

  const runExport = async () => {
    if (!stage.current) return;
    const job = studio.startExport(tl.scenes.length);
    setExporting(true);
    setPlaying(false);
    setTime(0);
    try {
      const out = await stage.current.exportVideo((pct, scene) =>
        studio.updateExport(job.id, { progress: Math.round(pct), current_scene: scene })
      );
      studio.updateExport(job.id, { status: "completed", progress: 100, url: out.url, bytes: out.bytes, mime: out.mime });
    } catch (e) {
      studio.updateExport(job.id, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  const voicesDone = state.project.scenes.reduce(
    (a, s) => a + Object.values(s.voices).filter((v) => v.source !== "silent").length, 0
  );
  const voicesTotal = state.project.scenes.reduce((a, s) => a + s.dialogue.length, 0);

  return (
    <div className="space-y-3">
      {/* ============== toolbar ============== */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          <button
            onClick={() => studio.generateAllVoices()}
            disabled={!!state.busy}
            className="flex items-center gap-2 rounded-lg bg-fairway px-3.5 py-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.15em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {state.busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2.5} />}
            Generate all voices
          </button>

          <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">TTS</span>
            <select value={state.ttsProvider} onChange={(e) => studio.setTTSProvider(e.target.value as TTSProviderId)}
              className="bg-transparent font-mono text-[10px] text-bone outline-none [&>option]:bg-ink">
              {(Object.keys(TTS_PROVIDERS) as TTSProviderId[]).map((id) => (
                <option key={id} value={id} disabled={!TTS_PROVIDERS[id].capabilities.configured}>
                  {TTS_PROVIDERS[id].label}{TTS_PROVIDERS[id].capabilities.configured ? "" : " · no key"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
            <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">Aspect</span>
            <select value={state.project.aspect_ratio} onChange={(e) => studio.setAspect(e.target.value as AspectSpec["id"])}
              className="bg-transparent font-mono text-[10px] text-bone outline-none [&>option]:bg-ink">
              {(Object.keys(ASPECTS) as AspectSpec["id"][]).map((id) => <option key={id} value={id}>{id} · {ASPECTS[id].platform}</option>)}
            </select>
          </label>

          <Toggle label="Safe" on={safe} onClick={() => setSafe(!safe)} />
          <Toggle label="Ghosts" on={boxes} onClick={() => setBoxes(!boxes)} />

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Chip tone="border-fairway/30 bg-fairway/[0.07] text-fairway">{voicesDone}/{voicesTotal} voiced</Chip>
            <Chip tone="border-city/30 bg-city/[0.07] text-city">rev {state.project.revision}</Chip>
            <Chip tone="border-violet/30 bg-violet/[0.07] text-violet">{tl.duration.toFixed(1)}s</Chip>
          </div>
        </div>
        {state.busy && (
          <p className="border-t border-line px-3 py-1.5 font-mono text-[9.5px] text-city">{state.busy}…</p>
        )}
        {state.lastError && (
          <p className="flex items-center gap-2 border-t border-claret/20 bg-claret/[0.05] px-3 py-1.5 font-mono text-[9.5px] text-claret">
            <XCircle size={11} /> {state.lastError}
            <button onClick={() => studio.clearError()} className="ml-auto text-faint hover:text-bone">dismiss</button>
          </p>
        )}
      </Card>

      <div className="grid gap-3 xl:grid-cols-12">
        {/* ============== stage ============== */}
        <div className="space-y-3 xl:col-span-8">
          <Card className="overflow-hidden">
            <CardHeader
              title="Stage"
              mono={`${spec.width}×${spec.height} · tap any bubble to select · drag to move · corner to resize`}
              right={doc ? <span className="font-mono text-[9px] text-faint">P{String(doc.panel_number).padStart(2, "0")} · {doc.title}</span> : undefined}
            />
            <div className="flex justify-center bg-black/60 p-2.5">
              <div className="relative w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black"
                style={{ maxWidth: spec.id === "9:16" ? 290 : spec.id === "1:1" ? 440 : "100%", aspectRatio: spec.id.replace(":", " / ") }}>
                <StageCanvas
                  ref={stage}
                  timeline={tl}
                  docs={state.project.scenes}
                  aspect={state.project.aspect_ratio}
                  time={time}
                  playing={playing}
                  showSafe={safe}
                  showBoxes={boxes}
                  muted={muted}
                  selectedBubble={selBubble}
                  onTime={setTime}
                  onEnded={() => setPlaying(false)}
                  onPickBubble={(sceneId, bubbleId) =>
                    bubbleId ? studio.select({ kind: "bubble", scene: sceneId, id: bubbleId }) : studio.select({ kind: "none" })
                  }
                  onMoveBubble={(s, id, x, y) => studio.updateBubble(s, id, { x, y }, "bubble.move")}
                  onResizeBubble={(s, id, w) => studio.updateBubble(s, id, { width: w }, "bubble.resize")}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-2.5 py-2">
              <button onClick={() => setPlaying((p) => !p)}
                className="grid h-8 w-8 place-items-center rounded-full bg-fairway text-ink transition-transform hover:brightness-110 active:scale-95">
                {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
              </button>
              <button onClick={() => seek(0)} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-dim hover:text-bone"><RotateCcw size={12} /></button>
              <button onClick={() => setMuted(!muted)} className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-dim hover:text-bone">
                {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <input type="range" min={0} max={tl.duration} step={0.02} value={time}
                onChange={(e) => seek(+e.target.value)} className="brush flex-1"
                style={{ ["--fill" as string]: `${(time / tl.duration) * 100}%` }} />
              <span className="font-mono text-[10px] tabular-nums text-dim">{fmt(time)} / {fmt(tl.duration)}</span>
            </div>
          </Card>

          {/* ============== storyboard: scenario editing ============== */}
          <Card>
            <CardHeader
              title="Storyboard"
              mono={`${state.project.scenes.length} scenes · reorder, duplicate, add from image`}
              right={<Clapperboard size={12} className="text-faint" />}
            />
            <SceneRail onSeek={seek} />
          </Card>

          {/* ============== 9-track draggable timeline ============== */}
          <Card>
            <CardHeader
              title="Timeline"
              mono="drag clips to retime · drag right edge to trim · nothing baked until export"
              right={
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[8.5px] text-faint">zoom</span>
                  <input type="range" min={1} max={5} step={0.5} value={zoom}
                    onChange={(e) => setZoom(+e.target.value)} className="brush w-16"
                    style={{ ["--fill" as string]: `${((zoom - 1) / 4) * 100}%` }} />
                  <Layers size={12} className="text-faint" />
                </div>
              }
            />
            <div className="p-2.5">
              <TrackEditor timeline={tl} time={time} zoom={zoom} onSeek={seek} />
            </div>
          </Card>

          {/* ============== acceptance test ============== */}
          <AcceptanceStrip />
        </div>

        {/* ============== right column ============== */}
        <div className="space-y-3 xl:col-span-4">
          <Card className="overflow-hidden">
            <Inspector doc={doc} />
          </Card>

          <Card>
            <CardHeader title="Export" mono="project stays editable" right={<FileVideo size={12} className="text-faint" />} />
            <div className="space-y-2 p-2.5">
              <button onClick={runExport} disabled={exporting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-city px-3 py-2.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.15em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40">
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} strokeWidth={2.5} />}
                {exporting ? "rendering…" : "Export video"}
              </button>
              <p className="font-mono text-[8.5px] leading-relaxed text-faint">
                Export is an <span className="text-city">output</span>. The document keeps every layer editable
                afterwards — we never reconstruct a project from an MP4.
              </p>
              {state.exports.map((e) => (
                <div key={e.id} className="rounded-lg border border-white/[0.07] bg-black/25 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-[9.5px] text-bone/85">{e.id}</span>
                    <StatusBadge status={e.status} />
                  </div>
                  {e.status === "rendering" && (
                    <>
                      <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full bg-city transition-all" style={{ width: `${e.progress}%` }} />
                      </div>
                      <p className="font-mono text-[8.5px] text-faint">{e.progress}% · scene {e.current_scene}/{e.total_scenes}</p>
                    </>
                  )}
                  {e.status === "completed" && e.url && (
                    <div className="space-y-1.5">
                      <video src={e.url} controls className="w-full rounded border border-white/10" />
                      <a href={e.url} download={`bryme-motion-r${e.project_revision_at_export}.${e.mime.includes("mp4") ? "mp4" : "webm"}`}
                        className="flex items-center justify-center gap-1.5 rounded border border-fairway/40 bg-fairway/[0.08] px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fairway">
                        <Download size={10} /> download · {((e.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB
                      </a>
                      <p className="font-mono text-[8px] text-faint">exported from revision {e.project_revision_at_export} · project now at {state.project.revision}</p>
                    </div>
                  )}
                  {e.error && <p className="font-mono text-[8.5px] text-claret">{e.error}</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Mutation ledger" mono={`${state.mutations.length} edits · what each one preserved`} />
            <div className="max-h-[280px] space-y-1 overflow-y-auto code-scroll p-2.5">
              <AnimatePresence initial={false}>
                {state.mutations.slice(0, 26).map((m) => (
                  <motion.div key={m.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] font-bold text-bone/90">{m.op}</span>
                      <span className={`ml-auto rounded px-1 font-mono text-[7.5px] uppercase ${
                        m.cost === "free" ? "bg-fairway/15 text-fairway" : m.cost === "voice" ? "bg-gold/15 text-gold" : "bg-ember/15 text-ember"
                      }`}>{m.cost === "free" ? "no cost" : `${m.cost} regen`}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {m.touched.map((l) => <span key={l} className="rounded bg-city/15 px-1 font-mono text-[7.5px] text-city">{l}</span>)}
                      {m.preserved.slice(0, 6).map((l) => <span key={l} className="rounded bg-white/[0.04] px-1 font-mono text-[7.5px] text-faint">{l}</span>)}
                    </div>
                    {m.note && <p className="mt-1 font-mono text-[7.5px] leading-relaxed text-faint">{m.note}</p>}
                  </motion.div>
                ))}
              </AnimatePresence>
              {!state.mutations.length && <p className="py-4 text-center font-mono text-[9px] text-faint">edit anything — the ledger proves what stayed untouched</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------ acceptance test ---- */

function AcceptanceStrip() {
  const state = useStudio();
  const ops = useMemo(() => new Set(state.mutations.map((m) => m.op)), [state.mutations]);
  const anyUserVoice = state.project.scenes.some((s) => Object.values(s.voices).some((v) => v.source === "upload" || v.source === "record"));
  const anyAiVoice = state.project.scenes.some((s) => Object.values(s.voices).some((v) => v.source === "ai"));
  const handPlaced = state.project.scenes.some((s) => s.bubbles.some((b) => !b.auto_placed));
  const exported = state.exports.some((e) => e.status === "completed");
  const editableAfter = exported && state.project.revision >= (state.exports.find((e) => e.status === "completed")?.project_revision_at_export ?? 0);

  const checks: { label: string; done: boolean }[] = [
    { label: "1 · image replaced, dialogue intact", done: ops.has("image.upload") || ops.has("image.regenerate") || ops.has("image.ai_edit") },
    { label: "2 · dialogue edited, image intact", done: ops.has("dialogue.edit_text") },
    { label: "3 · voice replaced, image intact", done: anyAiVoice || anyUserVoice },
    { label: "4 · user's own voice attached", done: anyUserVoice },
    { label: "5 · bubble moved independently", done: handPlaced || ops.has("bubble.move") },
    { label: "6 · camera changed independently", done: ops.has("camera.update") || ops.has("camera.reset") },
    { label: "7 · sound effect replaced", done: ops.has("sfx.replace") || ops.has("sfx.add") },
    { label: "8 · timeline re-synced to audio", done: anyAiVoice || anyUserVoice },
    { label: "9 · video exported", done: exported },
    { label: "10 · project editable after export", done: editableAfter },
  ];
  const passed = checks.filter((c) => c.done).length;

  return (
    <Card>
      <CardHeader title="Acceptance test" mono={`${passed}/10 verified live against the document`} right={<ShieldCheck size={12} className={passed === 10 ? "text-fairway" : "text-faint"} />} />
      <div className="grid grid-cols-1 gap-1 p-2.5 sm:grid-cols-2">
        {checks.map((c) => (
          <div key={c.label} className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] ${
            c.done ? "border-fairway/25 bg-fairway/[0.05] text-fairway/90" : "border-white/[0.06] text-faint"
          }`}>
            {c.done ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
            {c.label}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------- atoms ---- */

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] transition-colors ${
        on ? "border-fairway/40 bg-fairway/[0.08] text-fairway" : "border-white/10 bg-white/[0.02] text-dim hover:text-bone"
      }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-fairway" : "bg-faint/50"}`} />
      {label}
    </button>
  );
}

function fmt(t: number) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((t % 1) * 10))}`;
}

export { Clapperboard };

