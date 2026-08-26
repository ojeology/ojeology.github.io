import { useRef, useState } from "react";
import {
  Clapperboard, Download, Loader2, Pause, Play, Plus, RotateCcw, Trash2,
  Volume2, VolumeX, Zap,
} from "lucide-react";
import StageCanvas, { type StageHandle } from "./studio/StageCanvas";
import Inspector from "./studio/Inspector";
import { SceneRail } from "./studio/TrackEditor";
import PlayersPanel from "./studio/PlayersPanel";
import ImageTray from "./studio/ImageTray";
import { studio, useStudio, type SceneDocument } from "../engine/motion/studio";
import { ASPECTS, type AspectSpec } from "../engine/motion/types";
import { sceneAt } from "../engine/motion/timeline";
import { Card } from "./ui";

export default function MotionEditor() {
  const state = useStudio();
  const stage = useRef<StageHandle>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const latest = state.exports[0];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-fairway/20 bg-gradient-to-br from-fairway/[0.08] via-ink-2 to-city/[0.06] p-4 sm:p-5">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.28em] text-fairway">Match film</p>
        <h1 className="text-2xl font-bold tracking-tight text-bone sm:text-3xl">Edit the comic. Play it as a video.</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-bone/75">
          This is the City vs Bournemouth film. Click a scene, drag any speech bubble, double-click a bubble
          (or type in Banter) to rewrite the line, then hit Play. Nothing is locked — image, jokes, camera and sound
          are all separate layers.
        </p>
        <ol className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-dim">
          <Step n="1" label="Add players" />
          <Step n="2" label="Voice is UK English" />
          <Step n="3" label="Write banter" />
          <Step n="4" label="Save · Play" />
        </ol>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <div>
            <p className="text-[13px] font-bold text-bone">Scenes</p>
            <p className="font-mono text-[9px] text-faint">click one · add your own stills · reorder on hover</p>
          </div>
          <select
            value={state.project.aspect_ratio}
            onChange={(e) => studio.setAspect(e.target.value as AspectSpec["id"])}
            className="rounded-lg border border-white/10 bg-ink px-2 py-1 font-mono text-[10px] text-bone outline-none"
          >
            {(Object.keys(ASPECTS) as AspectSpec["id"][]).map((id) => (
              <option key={id} value={id}>{id} · {ASPECTS[id].platform}</option>
            ))}
          </select>
        </div>
        <SceneRail onSeek={seek} />
      </Card>

      <ImageTray sceneId={doc?.id} />

      <PlayersPanel />

      <div className="grid gap-3 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-8">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex items-center gap-2">
                <Clapperboard size={14} className="text-fairway" />
                <div>
                  <p className="text-[13px] font-bold text-bone">{doc?.title ?? "Stage"}</p>
                  <p className="font-mono text-[9px] text-faint">
                    {playing ? "Playing — pause to edit bubbles" : "Paused — bubbles are live. Drag them."}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] text-dim">
                {spec.width}×{spec.height}
              </span>
            </div>
            <div className="flex justify-center bg-black p-2 sm:p-3">
              <div
                className="relative w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black shadow-[0_0_80px_rgba(61,214,140,0.08)]"
                style={{ maxWidth: spec.id === "9:16" ? 320 : spec.id === "1:1" ? 480 : "100%", aspectRatio: spec.id.replace(":", " / ") }}
              >
                <StageCanvas
                  ref={stage}
                  timeline={tl}
                  docs={state.project.scenes}
                  aspect={state.project.aspect_ratio}
                  time={time}
                  playing={playing}
                  showSafe={false}
                  showBoxes={!playing}
                  muted={muted}
                  selectedBubble={selBubble}
                  editMode={!playing}
                  cinematic
                  onTime={setTime}
                  onEnded={() => setPlaying(false)}
                  onPickBubble={(sceneId, bubbleId) =>
                    bubbleId ? studio.select({ kind: "bubble", scene: sceneId, id: bubbleId }) : studio.select({ kind: "none" })
                  }
                  onMoveBubble={(s, id, x, y) => studio.updateBubble(s, id, { x, y }, "bubble.move")}
                  onResizeBubble={(s, id, w) => studio.updateBubble(s, id, { width: w }, "bubble.resize")}
                  onEditText={(s, bubbleId, text) => {
                    const scene = state.project.scenes.find((d) => d.id === s);
                    const line = scene?.dialogue.find((l) => l.bubble_id === bubbleId);
                    if (line) studio.editDialogueText(s, line.id, text);
                  }}
                  onDropImage={(file) => doc && studio.replaceImageFromFile(doc.id, file)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
              <button
                onClick={() => setPlaying((p) => !p)}
                className="grid h-11 w-11 place-items-center rounded-full bg-fairway text-ink shadow-lg shadow-fairway/20 transition-transform hover:brightness-110 active:scale-95"
              >
                {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>
              <button onClick={() => seek(0)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-dim hover:text-bone">
                <RotateCcw size={14} />
              </button>
              <button onClick={() => setMuted(!muted)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-dim hover:text-bone">
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range" min={0} max={tl.duration} step={0.02} value={time}
                onChange={(e) => seek(+e.target.value)} className="brush flex-1"
                style={{ ["--fill" as string]: `${(time / Math.max(0.01, tl.duration)) * 100}%` }}
              />
              <span className="font-mono text-[11px] tabular-nums text-dim">{fmt(time)} / {fmt(tl.duration)}</span>
            </div>
          </Card>

          {doc && <BanterPanel doc={doc} />}
        </div>

        <div className="space-y-3 xl:col-span-4">
          <Card className="overflow-hidden">
            <Inspector doc={doc} />
          </Card>

          <Card>
            <div className="border-b border-line px-3 py-2.5">
              <p className="text-[13px] font-bold text-bone">Export the film</p>
              <p className="font-mono text-[9px] text-faint">the project stays editable afterwards</p>
            </div>
            <div className="space-y-2 p-3">
              <button
                onClick={runExport}
                disabled={exporting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-city px-3 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} strokeWidth={2.5} />}
                {exporting ? "rendering…" : "Export video"}
              </button>
              {latest?.status === "completed" && latest.url && (
                <div className="space-y-1.5">
                  <video src={latest.url} controls className="w-full rounded-lg border border-white/10" />
                  <a
                    href={latest.url}
                    download={`bryme-match-film.${latest.mime.includes("mp4") ? "mp4" : "webm"}`}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-fairway/40 bg-fairway/[0.08] px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fairway"
                  >
                    <Download size={12} /> download · {((latest.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB
                  </a>
                </div>
              )}
              {latest?.error && <p className="font-mono text-[10px] text-claret">{latest.error}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BanterPanel({ doc }: { doc: SceneDocument }) {
  const { players } = useStudio();
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <p className="text-[13px] font-bold text-bone">Banter</p>
          <p className="font-mono text-[9px] text-faint">type a player name or pick one · then write the line</p>
        </div>
        <button
          onClick={() => studio.addDialogueLine(doc.id, players[0]?.name)}
          className="flex items-center gap-1.5 rounded-lg border border-fairway/40 bg-fairway/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fairway hover:bg-fairway/20"
        >
          <Plus size={12} /> Add line
        </button>
      </div>
      <datalist id="bryme-player-names">
        {players.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div className="divide-y divide-white/[0.05]">
        {doc.dialogue.map((line) => (
          <div key={line.id} className="flex gap-2 p-3">
            <div className="w-[148px] shrink-0 space-y-1">
              <input
                list="bryme-player-names"
                defaultValue={line.speaker_label}
                key={`${line.id}-${line.speaker_label}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== line.speaker_label) studio.setSpeaker(doc.id, line.id, v);
                }}
                placeholder="Player name"
                className="w-full rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[11px] text-city outline-none focus:border-city/50"
              />
              <button
                onClick={() => studio.speakDialogue(doc.id, line.id)}
                className="w-full rounded border border-white/10 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-faint hover:border-city/40 hover:text-city"
              >
                Hear line
              </button>
            </div>
            <textarea
              value={line.text}
              onChange={(e) => studio.editDialogueText(doc.id, line.id, e.target.value)}
              onFocus={() => studio.select({ kind: "dialogue", scene: doc.id, id: line.id })}
              rows={2}
              className="min-w-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-[14px] leading-relaxed text-bone outline-none focus:border-city/50"
            />
            <button
              onClick={() => studio.deleteDialogueLine(doc.id, line.id)}
              className="self-start rounded border border-white/10 p-1.5 text-faint hover:border-claret/40 hover:text-claret"
              title="Delete line"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {doc.dialogue.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-faint">No lines yet — add one and start the argument.</p>
        )}
      </div>
    </Card>
  );
}

function Step({ n, label }: { n: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1">
      <span className="grid h-4 w-4 place-items-center rounded-full bg-fairway font-bold text-ink">{n}</span>
      {label}
    </li>
  );
}

function fmt(t: number) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
