import { useRef, useState } from "react";
import {
  Download, Image as ImageIcon, Loader2, Mic, MicOff, Pause, Play,
  Plus, Save, Trash2, Type, Upload, Volume2, VolumeX,
} from "lucide-react";
import StageCanvas, { type StageHandle } from "./studio/StageCanvas";
import { studio, useStudio, type SceneDocument } from "../engine/motion/studio";
import { recorder, voiceFromFile } from "../engine/motion/editProviders";
import { STILL_LIBRARY } from "../engine/motion/library";
import { sceneAt } from "../engine/motion/timeline";

type Tab = "photos" | "text" | "voice";

export default function MotionEditor() {
  const state = useStudio();
  const stage = useRef<StageHandle>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<Tab>("photos");

  const tl = state.timeline;
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
  const saved =
    state.saveStatus === "saved" ? "Saved" : state.saveStatus === "error" ? "Couldn’t save" : state.saveStatus === "unsaved" ? "Not saved" : "Saving…";

  return (
    <div className="flex h-screen flex-col bg-[#111113] text-white">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3">
        <div className="flex items-center gap-2 pr-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FE2C55] text-[11px] font-black">B</span>
          <span className="text-[15px] font-semibold tracking-tight">BRYME</span>
        </div>
        <span className="hidden text-sm text-white/50 sm:inline">City vs Bournemouth</span>
        <span className={`ml-auto text-xs ${state.saveStatus === "saved" ? "text-emerald-400" : state.saveStatus === "error" ? "text-rose-400" : "text-white/40"}`}>
          {saved}
        </span>
        <button
          onClick={() => studio.saveNow()}
          className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          <Save size={14} /> Save
        </button>
        <button
          onClick={runExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-full bg-[#FE2C55] px-4 py-1.5 text-sm font-semibold hover:brightness-110 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {exporting ? "Making video…" : "Download"}
        </button>
      </header>

      {state.lastError && (
        <div className="flex items-center justify-between bg-rose-500/15 px-4 py-2 text-sm text-rose-200">
          <span>{plainError(state.lastError)}</span>
          <button onClick={() => studio.clearError()} className="text-white/70">Dismiss</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-white/10 py-3">
          <RailBtn active={tab === "photos"} onClick={() => setTab("photos")} icon={ImageIcon} label="Photos" />
          <RailBtn active={tab === "text"} onClick={() => setTab("text")} icon={Type} label="Text" />
          <RailBtn active={tab === "voice"} onClick={() => setTab("voice")} icon={Mic} label="Voice" />
        </nav>

        <aside className="flex w-[280px] shrink-0 flex-col border-r border-white/10 bg-[#18181B] max-sm:absolute max-sm:inset-y-14 max-sm:left-16 max-sm:z-20 max-sm:w-[min(280px,calc(100vw-4rem))]">
          {tab === "photos" && <PhotosPanel sceneId={doc?.id} current={doc?.image.current.url} />}
          {tab === "text" && doc && <TextPanel doc={doc} />}
          {tab === "voice" && doc && <VoicePanel doc={doc} />}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-black">
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <div
              className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl"
              style={{ maxWidth: 920, aspectRatio: "16 / 9" }}
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

          <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2.5">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="grid h-11 w-11 place-items-center rounded-full bg-white text-black hover:brightness-95"
            >
              {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <button onClick={() => setMuted(!muted)} className="text-white/70 hover:text-white">
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range" min={0} max={tl.duration || 1} step={0.02} value={time}
              onChange={(e) => seek(+e.target.value)}
              className="h-1 flex-1 cursor-pointer accent-[#FE2C55]"
            />
            <span className="w-20 text-right text-xs tabular-nums text-white/50">{fmt(time)} / {fmt(tl.duration)}</span>
          </div>
        </main>
      </div>

      <FilmStrip activeId={doc?.id} onSeek={seek} />

      {latest?.status === "completed" && latest.url && (
        <div className="flex items-center gap-3 border-t border-white/10 bg-[#18181B] px-4 py-2">
          <video src={latest.url} controls className="h-12 rounded" />
          <a href={latest.url} download="bryme-video.webm" className="text-sm font-semibold text-[#FE2C55]">
            Save video to phone
          </a>
        </div>
      )}
    </div>
  );
}

function RailBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof ImageIcon; label: string }) {
  return (
    <button onClick={onClick} className={`flex w-full flex-col items-center gap-1 py-3 text-[11px] ${active ? "text-white" : "text-white/40 hover:text-white/80"}`}>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-[#FE2C55]" : "bg-white/5"}`}>
        <Icon size={16} />
      </span>
      {label}
    </button>
  );
}

function PhotosPanel({ sceneId, current }: { sceneId: string | undefined; current?: string }) {
  const replace = useRef<HTMLInputElement>(null);
  const addScene = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 py-3 text-sm font-semibold">Photos</p>
      <div className="flex gap-2 px-3 pb-3">
        <button onClick={() => replace.current?.click()} disabled={!sceneId}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-2 text-xs font-semibold hover:bg-white/15 disabled:opacity-40">
          <Upload size={13} /> This scene
        </button>
        <button onClick={() => addScene.current?.click()}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 py-2 text-xs font-semibold hover:bg-white/15">
          <Plus size={13} /> New scene
        </button>
      </div>
      <input ref={replace} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f && sceneId) studio.replaceImageFromFile(sceneId, f); e.target.value = ""; }} />
      <input ref={addScene} type="file" accept="image/*" hidden multiple
        onChange={async (e) => { for (const f of Array.from(e.target.files ?? [])) await studio.addSceneFromImage(f); e.target.value = ""; }} />
      <div className="grid grid-cols-2 gap-1.5 overflow-y-auto px-3 pb-4">
        {STILL_LIBRARY.map((still) => (
          <button key={still.url} disabled={!sceneId} onClick={() => sceneId && studio.applyImageUrl(sceneId, still.url, still.title)}
            className={`overflow-hidden rounded-lg border ${current === still.url ? "border-[#FE2C55]" : "border-transparent"}`}>
            <img src={still.url} alt="" className="h-20 w-full object-cover" />
            <span className="block truncate bg-black/40 px-1.5 py-1 text-left text-[11px]">{still.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TextPanel({ doc }: { doc: SceneDocument }) {
  const { players } = useStudio();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <p className="text-sm font-semibold">Speech bubbles</p>
        <button onClick={() => studio.addDialogueLine(doc.id, players[0]?.name)}
          className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/15">
          <Plus size={12} /> Add
        </button>
      </div>
      <p className="px-3 pb-2 text-xs text-white/45">Drag bubbles on the video onto the player. Edit the words here.</p>
      <datalist id="bryme-player-names">
        {players.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {doc.dialogue.map((line) => (
          <LineEditor key={line.id} doc={doc} lineId={line.id} compact />
        ))}
        {doc.dialogue.length === 0 && <p className="px-3 py-6 text-center text-sm text-white/40">No text yet. Tap Add.</p>}
      </div>
    </div>
  );
}

function VoicePanel({ doc }: { doc: SceneDocument }) {
  const { players } = useStudio();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 py-3 text-sm font-semibold">My voice</p>
      <p className="px-3 pb-2 text-xs text-white/45">Record each line with your own voice. Your take plays in the video.</p>
      <datalist id="bryme-player-names">
        {players.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {doc.dialogue.map((line) => (
          <LineEditor key={line.id} doc={doc} lineId={line.id} voiceFirst />
        ))}
      </div>
    </div>
  );
}

function LineEditor({ doc, lineId, compact, voiceFirst }: { doc: SceneDocument; lineId: string; compact?: boolean; voiceFirst?: boolean }) {
  const line = doc.dialogue.find((l) => l.id === lineId);
  const voice = doc.voices[lineId];
  const fileRef = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!line) return null;

  const mine = voice?.source === "record" || voice?.source === "upload";
  const hasTake = !!(voice?.url && !voice.label.includes("STALE") && !voice.label.includes("record again"));

  const startRec = async () => {
    setErr(null);
    try {
      await recorder.start();
      setRec(true);
    } catch {
      setErr("Allow the microphone, then try again.");
    }
  };
  const stopRec = async () => {
    try {
      const audio = await recorder.stop();
      await studio.attachUserVoice(doc.id, lineId, audio, "record");
    } catch {
      setErr("Could not save that. Try again.");
    } finally {
      setRec(false);
    }
  };

  return (
    <div className="border-b border-white/5 px-3 py-3">
      {!compact && <p className="mb-1.5 line-clamp-2 text-[13px] text-white/80">“{line.text}”</p>}
      <input
        list="bryme-player-names"
        defaultValue={line.speaker_label}
        key={`${line.id}-${line.speaker_label}`}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== line.speaker_label) studio.setSpeaker(doc.id, line.id, v);
        }}
        placeholder="Who is talking?"
        className="mb-1.5 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs outline-none focus:border-[#FE2C55]"
      />
      {compact && (
        <textarea
          value={line.text}
          onChange={(e) => studio.editDialogueText(doc.id, line.id, e.target.value)}
          rows={2}
          className="mb-2 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-[#FE2C55]"
        />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {rec ? (
          <button onClick={stopRec} className="flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold">
            <MicOff size={12} /> Stop
          </button>
        ) : (
          <button onClick={startRec} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${voiceFirst ? "bg-[#FE2C55]" : "bg-white/10"}`}>
            <Mic size={12} /> Record
          </button>
        )}
        <button onClick={() => fileRef.current?.click()} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">Upload</button>
        <button onClick={() => studio.speakDialogue(doc.id, line.id)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs">Play</button>
        <button onClick={() => studio.deleteDialogueLine(doc.id, line.id)} className="ml-auto text-white/30 hover:text-rose-400"><Trash2 size={13} /></button>
        <input ref={fileRef} type="file" accept="audio/*" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try { await studio.attachUserVoice(doc.id, lineId, await voiceFromFile(f), "upload"); }
            catch { setErr("Could not read that file."); }
          }} />
      </div>
      <p className={`mt-1 text-[11px] ${mine && hasTake ? "text-emerald-400" : "text-white/35"}`}>
        {rec ? "Speak now…" : mine && hasTake ? "Your voice is on this line" : mine ? "Record again" : "Using the built-in voice"}
      </p>
      {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
    </div>
  );
}

function FilmStrip({ activeId, onSeek }: { activeId?: string; onSeek: (t: number) => void }) {
  const state = useStudio();
  const file = useRef<HTMLInputElement>(null);
  const tl = state.timeline;
  return (
    <div className="flex h-[108px] shrink-0 items-stretch gap-2 overflow-x-auto border-t border-white/10 bg-[#18181B] px-3 py-2">
      {state.project.scenes.map((doc, i) => {
        const scene = tl.scenes.find((s) => s.id === doc.id);
        const on = doc.id === activeId;
        return (
          <button key={doc.id} onClick={() => scene && onSeek(scene.offset + 0.05)}
            className={`relative w-[140px] shrink-0 overflow-hidden rounded-lg border ${on ? "border-[#FE2C55]" : "border-white/10"}`}>
            {doc.image.current.url
              ? <img src={doc.image.current.url} alt="" className="h-full w-full object-cover" />
              : <div className="grid h-full place-items-center text-xs text-white/30">No photo</div>}
            <span className="absolute bottom-0 left-0 right-0 bg-black/70 px-1.5 py-0.5 text-left text-[11px]">
              Scene {i + 1}
            </span>
          </button>
        );
      })}
      <button onClick={() => file.current?.click()}
        className="grid w-[88px] shrink-0 place-items-center rounded-lg border border-dashed border-white/20 text-white/50 hover:border-white/40 hover:text-white">
        <span className="text-center text-xs"><Plus size={16} className="mx-auto mb-1" />Add</span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden multiple
        onChange={async (e) => { for (const f of Array.from(e.target.files ?? [])) await studio.addSceneFromImage(f); e.target.value = ""; }} />
    </div>
  );
}

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function plainError(msg: string) {
  if (/microphone|mic/i.test(msg)) return "Allow the microphone in your browser.";
  if (/storage|quota|save/i.test(msg)) return "Couldn’t save — storage may be full.";
  return msg.replace(/^[A-Z0-9_]+:\s*/, "");
}
