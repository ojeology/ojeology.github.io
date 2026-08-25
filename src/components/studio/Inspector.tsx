import { useRef, useState } from "react";
import {
  Camera, Copy, Download, Film, ImageUp, Mic, MicOff, Music4, Palette, Pin, PinOff,
  Play, Plus, RefreshCw, Sparkles, Trash2, Undo2, Upload, Users, Volume2, Wand2, X,
} from "lucide-react";
import { studio, useStudio, type BubbleLayer, type SceneDocument } from "../../engine/motion/studio";
import { SFX_LIBRARY, type BubbleStyle, type CameraMove, type SfxId, type TransitionKind } from "../../engine/motion/types";
import { SPORTS_BIBLE, SQUAD_TEAMS, sportsCharacter, squadFor } from "../../engine/motion/sportsbible";
import { previewAudio, recorder, voiceFromFile } from "../../engine/motion/editProviders";
import { IMAGE_EDIT_PROVIDERS, type ImageEditProviderId } from "../../engine/motion/editProviders";
import { Chip } from "../ui";

const CAMERA_MOVES: CameraMove[] = [
  "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down",
  "focus_character", "focus_center", "shake", "slow_drift",
];
const BUBBLE_STYLES: BubbleStyle[] = ["speech", "shout", "whisper", "thought", "commentator", "narration", "crowd"];
const ANIMS = ["fade_in", "pop_in", "slide_in", "bounce_in", "shake_in"] as const;
const TRANSITIONS: TransitionKind[] = ["cut", "crossfade", "dip_to_black", "whip_pan", "flash"];
const SWATCHES = ["#F7F5EF", "#FFE9C7", "#EEF2EA", "#101410", "#14120C", "#6CB4EE", "#3DD68C", "#C8102E", "#E8C15A", "#A78BFA"];

export default function Inspector({ doc }: { doc: SceneDocument | undefined }) {
  const state = useStudio();
  const sel = state.selection;
  if (!doc) return <Empty text="no scene" />;

  switch (sel.kind) {
    case "image": return <ImagePanel doc={doc} />;
    case "bubble": return <BubblePanel doc={doc} bubbleId={sel.id} />;
    case "dialogue": return <DialoguePanel doc={doc} lineId={sel.id} />;
    case "voice": return <VoicePanel doc={doc} lineId={sel.id} />;
    case "sfx": return <SfxPanel doc={doc} instId={sel.id} />;
    case "camera": return <CameraPanel doc={doc} />;
    case "transition": return <TransitionPanel doc={doc} />;
    case "music": return <MusicPanel doc={doc} />;
    case "character": return <CharacterPanel doc={doc} charId={sel.id} />;
    default: return <SceneOverview doc={doc} />;
  }
}

/* ---------------------------------------------------- atoms ---- */

function Head({ icon: Icon, title, sub, onClose }: { icon: typeof Camera; title: string; sub?: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-line px-3 py-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded border border-fairway/30 bg-fairway/10">
        <Icon size={12} className="text-fairway" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-bone">{title}</p>
        {sub && <p className="truncate font-mono text-[9px] text-faint">{sub}</p>}
      </div>
      {onClose && (
        <button onClick={onClose} className="text-faint hover:text-bone"><X size={13} /></button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-[68px] shrink-0 font-mono text-[8.5px] uppercase tracking-[0.15em] text-faint">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="brush flex-1"
        style={{ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      <span className="w-9 shrink-0 text-right font-mono text-[9.5px] tabular-nums text-dim">{value.toFixed(2)}</span>
    </>
  );
}

function Btn({ children, onClick, tone = "ghost", disabled, title }: {
  children: React.ReactNode; onClick?: () => void; tone?: "ghost" | "green" | "blue" | "red"; disabled?: boolean; title?: string;
}) {
  const skin = {
    ghost: "border-white/10 bg-white/[0.03] text-dim hover:text-bone hover:border-white/25",
    green: "border-fairway/40 bg-fairway/10 text-fairway hover:bg-fairway/20",
    blue: "border-city/40 bg-city/10 text-city hover:bg-city/20",
    red: "border-claret/40 bg-claret/10 text-claret hover:bg-claret/20",
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${skin}`}>
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-8 text-center font-mono text-[10px] text-faint">{text}</p>;
}

function Preserved({ note }: { note: string }) {
  return (
    <p className="mt-2 rounded border border-fairway/15 bg-fairway/[0.04] px-2 py-1.5 font-mono text-[8.5px] leading-relaxed text-fairway/80">
      ✓ {note}
    </p>
  );
}

/* --------------------------------------------------- panels ---- */

function SceneOverview({ doc }: { doc: SceneDocument }) {
  const timing = studio.timingFor(doc.id);
  return (
    <div>
      <Head icon={Film} title={doc.title} sub={`${doc.panel_id} · rev ${doc.revision} · ${timing.duration.toFixed(2)}s`} />
      <div className="p-3">
        <p className="mb-3 font-mono text-[9px] leading-relaxed text-faint">
          Tap any element on the stage or in the timeline to edit it. Every layer below is an
          independent object — editing one never rebuilds the others.
        </p>
        <div className="space-y-1">
          <LayerRow label="image" value={doc.image.current.source} onClick={() => studio.select({ kind: "image", scene: doc.id })} />
          <LayerRow label="characters" value={`${doc.characters.length} from Sports Bible`} onClick={() => doc.characters[0] && studio.select({ kind: "character", scene: doc.id, id: doc.characters[0].character_id })} />
          <LayerRow label="dialogue" value={`${doc.dialogue.length} lines`} onClick={() => doc.dialogue[0] && studio.select({ kind: "dialogue", scene: doc.id, id: doc.dialogue[0].id })} />
          <LayerRow label="voice" value={`${Object.values(doc.voices).filter((v) => v.source !== "silent").length}/${doc.dialogue.length} recorded`} onClick={() => doc.dialogue[0] && studio.select({ kind: "voice", scene: doc.id, id: doc.dialogue[0].id })} />
          <LayerRow label="bubbles" value={`${doc.bubbles.length} objects`} onClick={() => doc.bubbles[0] && studio.select({ kind: "bubble", scene: doc.id, id: doc.bubbles[0].id })} />
          <LayerRow label="sfx" value={`${doc.sfx.length} cues`} onClick={() => doc.sfx[0] && studio.select({ kind: "sfx", scene: doc.id, id: doc.sfx[0].id })} />
          <LayerRow label="music" value={doc.music.enabled ? doc.music.label : "off"} onClick={() => studio.select({ kind: "music", scene: doc.id })} />
          <LayerRow label="camera" value={doc.camera.move} onClick={() => studio.select({ kind: "camera", scene: doc.id })} />
          <LayerRow label="transition" value={doc.transition.kind} onClick={() => studio.select({ kind: "transition", scene: doc.id })} />
        </div>
      </div>
    </div>
  );
}

function LayerRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-left transition-colors hover:border-city/40">
      <span className="w-[74px] shrink-0 font-mono text-[8.5px] uppercase tracking-[0.15em] text-faint">{label}</span>
      <span className="truncate font-mono text-[10px] text-bone/80">{value}</span>
    </button>
  );
}

/* ---- IMAGE ---- */

function ImagePanel({ doc }: { doc: SceneDocument }) {
  const state = useStudio();
  const [prompt, setPrompt] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const provider = IMAGE_EDIT_PROVIDERS[state.imageProvider];

  return (
    <div>
      <Head icon={ImageUp} title="Image layer" sub={`${doc.image.current.source} · ${doc.image.history.length} previous revisions`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        {doc.image.current.url && (
          <img src={doc.image.current.url} alt="" className="mb-2 aspect-video w-full rounded border border-white/10 object-cover" />
        )}
        <p className="mb-2 font-mono text-[9px] text-faint">{doc.image.current.note}</p>

        <Row label="provider">
          <select
            value={state.imageProvider}
            onChange={(e) => studio.setImageProvider(e.target.value as ImageEditProviderId)}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none focus:border-city/50"
          >
            {(Object.keys(IMAGE_EDIT_PROVIDERS) as ImageEditProviderId[]).map((id) => (
              <option key={id} value={id}>
                {IMAGE_EDIT_PROVIDERS[id].label}{IMAGE_EDIT_PROVIDERS[id].capabilities.configured ? "" : " · server-side"}
              </option>
            ))}
          </select>
        </Row>
        <p className="mb-2 mt-1 font-mono text-[8.5px] leading-relaxed text-faint">{provider.capabilities.notes}</p>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="Describe an edit — e.g. 'make the floodlights warmer, add rain'"
          className="mb-2 w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-bone outline-none focus:border-city/50"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <Btn tone="blue" onClick={() => studio.regenerateImage(doc.id, prompt || undefined, true)} disabled={!!state.busy}>
            <Wand2 size={11} /> AI edit
          </Btn>
          <Btn tone="green" onClick={() => studio.regenerateImage(doc.id, prompt || undefined, false)} disabled={!!state.busy}>
            <RefreshCw size={11} /> Regenerate
          </Btn>
          <Btn onClick={() => file.current?.click()}><Upload size={11} /> Upload</Btn>
          <Btn onClick={() => studio.revertImage(doc.id)} disabled={!doc.image.history.length}>
            <Undo2 size={11} /> Revert
          </Btn>
        </div>
        <input
          ref={file} type="file" accept="image/*" hidden
          onChange={(e) => e.target.files?.[0] && studio.replaceImageFromFile(doc.id, e.target.files[0])}
        />

        {doc.image.history.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">revision history</p>
            <div className="flex gap-1.5 overflow-x-auto code-scroll pb-1">
              {doc.image.history.map((h) => (
                <img key={h.id} src={h.url} title={h.note} alt="" className="h-10 w-16 shrink-0 rounded border border-white/10 object-cover opacity-60" />
              ))}
            </div>
          </div>
        )}
        <Preserved note="Replacing this image keeps dialogue, voices, bubbles, SFX, camera and timing exactly as they are." />
      </div>
    </div>
  );
}

/* ---- BUBBLE ---- */

function BubblePanel({ doc, bubbleId }: { doc: SceneDocument; bubbleId: string }) {
  const b = doc.bubbles.find((x) => x.id === bubbleId);
  const line = doc.dialogue.find((l) => l.bubble_id === bubbleId);
  if (!b) return <Empty text="bubble deleted" />;
  const set = (p: Partial<BubbleLayer>) => studio.updateBubble(doc.id, bubbleId, p);

  return (
    <div>
      <Head icon={Palette} title="Speech bubble" sub={`${b.id} · ${b.auto_placed ? "auto-placed" : "hand-placed"}`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        {line && (
          <textarea
            value={line.text}
            onChange={(e) => studio.editDialogueText(doc.id, line.id, e.target.value)}
            rows={2}
            className="mb-2 w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-relaxed text-bone outline-none focus:border-city/50"
          />
        )}
        <Row label="style">
          <div className="flex flex-wrap gap-1">
            {BUBBLE_STYLES.map((s) => (
              <button key={s} onClick={() => studio.applyBubblePreset(doc.id, bubbleId, s)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${b.style === s ? "border-city/50 bg-city/10 text-city" : "border-white/10 text-dim hover:text-bone"}`}>
                {s}
              </button>
            ))}
          </div>
        </Row>
        <Row label="speaker">
          <select value={line?.speaker_label ?? ""} onChange={(e) => line && studio.setDialogueField(doc.id, line.id, { speaker_label: e.target.value })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none">
            {["City Player", "City Captain", "City Midfielder", "Keeper", "Commentator", "Narrator", "Crowd"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Row>
        <Row label="x"><Slider value={b.x} min={0.05} max={0.95} step={0.01} onChange={(v) => set({ x: v })} /></Row>
        <Row label="y"><Slider value={b.y} min={0.05} max={0.95} step={0.01} onChange={(v) => set({ y: v })} /></Row>
        <Row label="width"><Slider value={b.width} min={0.15} max={0.9} step={0.01} onChange={(v) => set({ width: v })} /></Row>
        <Row label="font size"><Slider value={b.font_scale} min={0.6} max={1.8} step={0.05} onChange={(v) => set({ font_scale: v })} /></Row>
        <Row label="font">
          {(["display", "mono", "comic"] as const).map((f) => (
            <button key={f} onClick={() => set({ font_family: f })}
              className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${b.font_family === f ? "border-city/50 bg-city/10 text-city" : "border-white/10 text-dim"}`}>{f}</button>
          ))}
        </Row>
        <Row label="fill">
          <div className="flex flex-wrap gap-1">
            {SWATCHES.map((c) => (
              <button key={c} onClick={() => set({ fill: c })} style={{ background: c }}
                className={`h-4 w-4 rounded border ${b.fill === c ? "border-fairway" : "border-white/20"}`} />
            ))}
          </div>
        </Row>
        <Row label="text">
          <div className="flex flex-wrap gap-1">
            {["#12140F", "#F2F6EE", "#6CB4EE", "#3DD68C", "#E8C15A", "#C8102E"].map((c) => (
              <button key={c} onClick={() => set({ text_color: c })} style={{ background: c }}
                className={`h-4 w-4 rounded border ${b.text_color === c ? "border-fairway" : "border-white/20"}`} />
            ))}
          </div>
        </Row>
        <Row label="anim in">
          <select value={b.anim_in} onChange={(e) => set({ anim_in: e.target.value as BubbleLayer["anim_in"] })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none">
            {ANIMS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Row>
        <Row label="lead"><Slider value={b.lead} min={0} max={1} step={0.02} onChange={(v) => set({ lead: v })} /></Row>
        <Row label="hold"><Slider value={b.hold} min={0} max={2} step={0.02} onChange={(v) => set({ hold: v })} /></Row>

        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Btn onClick={() => studio.duplicateBubble(doc.id, bubbleId)}><Copy size={11} /> Dup</Btn>
          <Btn onClick={() => set({ visible: !b.visible })}>{b.visible ? "Hide" : "Show"}</Btn>
          <Btn tone="red" onClick={() => studio.deleteBubble(doc.id, bubbleId)}><Trash2 size={11} /> Del</Btn>
        </div>
        <Preserved note="Bubble edits never regenerate the image or re-synthesize the voice." />
      </div>
    </div>
  );
}

/* ---- DIALOGUE ---- */

function DialoguePanel({ doc, lineId }: { doc: SceneDocument; lineId: string }) {
  const line = doc.dialogue.find((l) => l.id === lineId);
  const voice = doc.voices[lineId];
  const timing = studio.timingFor(doc.id).slots.find((s) => s.dialogue_id === lineId);
  if (!line) return <Empty text="line deleted" />;

  return (
    <div>
      <Head icon={Sparkles} title="Dialogue line" sub={`${line.id} · order ${line.order}`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <textarea
          value={line.text}
          onChange={(e) => studio.editDialogueText(doc.id, lineId, e.target.value)}
          rows={3}
          className="mb-2 w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] leading-relaxed text-bone outline-none focus:border-city/50"
        />
        <div className="mb-2 flex flex-wrap gap-1">
          <Chip tone="border-gold/25 bg-gold/[0.06] text-gold/90">{line.language_label}</Chip>
          <Chip tone="border-violet/25 bg-violet/[0.06] text-violet/90">{line.emotion}</Chip>
          {timing && <Chip>{timing.audio_start.toFixed(2)}s → {timing.audio_end.toFixed(2)}s</Chip>}
        </div>
        <Row label="speaker">
          <select value={line.speaker_label} onChange={(e) => studio.setDialogueField(doc.id, lineId, { speaker_label: e.target.value })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none">
            {["City Player", "City Captain", "City Midfielder", "Keeper", "Commentator", "Narrator", "Crowd"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Row>
        <Row label="character">
          <select value={line.character_id ?? ""} onChange={(e) => studio.setDialogueField(doc.id, lineId, { character_id: e.target.value || null })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9px] text-bone outline-none">
            <option value="">— none —</option>
            {SPORTS_BIBLE.map((c) => <option key={c.id} value={c.id}>{c.name}{c.squad_number ? ` #${c.squad_number}` : ""}</option>)}
          </select>
        </Row>
        <Row label="emotion">
          <select value={line.emotion} onChange={(e) => studio.setDialogueField(doc.id, lineId, { emotion: e.target.value })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none">
            {["calm", "confident", "playful", "mocking", "defiant", "excited", "energetic", "roaring", "angry"].map((e2) => <option key={e2}>{e2}</option>)}
          </select>
        </Row>
        <Row label="language">
          <input value={line.language_label} onChange={(e) => studio.setDialogueField(doc.id, lineId, { language_label: e.target.value })}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none" />
        </Row>
        <Row label="start">
          <Btn onClick={() => studio.pinDialogueStart(doc.id, lineId, line.start_override == null ? (timing?.audio_start ?? 0) : null)}>
            {line.start_override == null ? <><PinOff size={11} /> auto</> : <><Pin size={11} /> {line.start_override.toFixed(2)}s</>}
          </Btn>
        </Row>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Btn tone="blue" onClick={() => studio.select({ kind: "voice", scene: doc.id, id: lineId })}><Mic size={11} /> Voice</Btn>
          <Btn tone="red" onClick={() => studio.deleteDialogueLine(doc.id, lineId)}><Trash2 size={11} /> Delete line</Btn>
        </div>
        {voice?.label.includes("STALE") && (
          <p className="mt-2 rounded border border-gold/25 bg-gold/[0.06] px-2 py-1.5 font-mono text-[8.5px] text-gold">
            Text changed after this audio was made — regenerate the voice when you're ready. Nothing was auto-billed.
          </p>
        )}
        <Preserved note="Editing text never touches the image. Pidgin is stored exactly as typed — no translation." />
      </div>
    </div>
  );
}

/* ---- VOICE ---- */

function VoicePanel({ doc, lineId }: { doc: SceneDocument; lineId: string }) {
  const state = useStudio();
  const v = doc.voices[lineId];
  const line = doc.dialogue.find((l) => l.id === lineId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v || !line) return <Empty text="line deleted" />;

  const startRec = async () => {
    setErr(null);
    try {
      await recorder.start();
      setRec(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const stopRec = async () => {
    try {
      const audio = await recorder.stop();
      studio.attachUserVoice(doc.id, lineId, audio, "record");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRec(false);
    }
  };

  return (
    <div>
      <Head icon={Mic} title="Voice layer" sub={`${v.source} · ${v.duration.toFixed(2)}s ${v.duration_source}`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <p className="mb-2 rounded border border-white/[0.06] bg-black/30 px-2 py-1.5 text-[11px] leading-relaxed text-bone/85">“{line.text}”</p>
        <div className="mb-2 flex flex-wrap gap-1">
          <Chip tone={v.source === "silent" ? "border-white/10 bg-white/[0.03] text-faint" : "border-fairway/30 bg-fairway/[0.07] text-fairway"}>{v.label}</Chip>
          {v.cache_key && <Chip>cached</Chip>}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Btn tone="green" onClick={() => studio.generateVoice(doc.id, lineId)} disabled={!!state.busy}>
            <Sparkles size={11} /> AI voice
          </Btn>
          {rec ? (
            <Btn tone="red" onClick={stopRec}><MicOff size={11} /> Stop</Btn>
          ) : (
            <Btn tone="blue" onClick={startRec}><Mic size={11} /> Record</Btn>
          )}
          <Btn onClick={() => fileRef.current?.click()}><Upload size={11} /> Upload</Btn>
          <Btn onClick={() => v.url && previewAudio(v.url, v.gain, v.speed)} disabled={!v.url}><Play size={11} /> Preview</Btn>
        </div>
        <input ref={fileRef} type="file" accept="audio/*" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              studio.attachUserVoice(doc.id, lineId, await voiceFromFile(f), "upload");
            } catch (er) {
              setErr(er instanceof Error ? er.message : String(er));
            }
          }} />
        {rec && (
          <p className="mt-2 flex items-center gap-2 rounded border border-claret/30 bg-claret/[0.08] px-2 py-1.5 font-mono text-[9px] text-claret">
            <span className="h-2 w-2 animate-pulse rounded-full bg-claret" /> recording — speak your line, then press stop
          </p>
        )}
        {err && <p className="mt-2 rounded border border-claret/25 bg-claret/[0.06] px-2 py-1.5 font-mono text-[8.5px] text-claret">{err}</p>}

        <div className="mt-3 space-y-0.5">
          <Row label="gain"><Slider value={v.gain} min={0} max={1.5} step={0.05} onChange={(x) => studio.updateVoice(doc.id, lineId, { gain: x })} /></Row>
          <Row label="speed"><Slider value={v.speed} min={0.5} max={2} step={0.05} onChange={(x) => studio.updateVoice(doc.id, lineId, { speed: x })} /></Row>
          <Row label="pitch"><Slider value={v.pitch} min={0.5} max={2} step={0.05} onChange={(x) => studio.updateVoice(doc.id, lineId, { pitch: x })} /></Row>
          <Row label="offset"><Slider value={v.offset} min={-1} max={2} step={0.05} onChange={(x) => studio.updateVoice(doc.id, lineId, { offset: x })} /></Row>
        </div>

        <div className="mt-2">
          <Btn tone="red" onClick={() => studio.deleteVoice(doc.id, lineId)} disabled={v.source === "silent"}>
            <Trash2 size={11} /> Delete audio
          </Btn>
        </div>
        <Preserved note="Swapping or recording a voice re-syncs the timeline and bubble automatically. The image is never regenerated." />
      </div>
    </div>
  );
}

/* ---- SFX ---- */

function SfxPanel({ doc, instId }: { doc: SceneDocument; instId: string }) {
  const s = doc.sfx.find((x) => x.id === instId);
  if (!s) return <Empty text="cue deleted" />;
  return (
    <div>
      <Head icon={Volume2} title="Sound effect" sub={`${s.id} · CC0 / original synthesis`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <Row label="sound">
          <select value={s.sfx} onChange={(e) => studio.replaceSfx(doc.id, instId, e.target.value as SfxId)}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9.5px] text-bone outline-none">
            {Object.values(SFX_LIBRARY).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Row>
        <Row label="start"><Slider value={s.start} min={0} max={10} step={0.05} onChange={(v) => studio.updateSfx(doc.id, instId, { start: v })} /></Row>
        <Row label="length"><Slider value={s.duration} min={0.2} max={10} step={0.1} onChange={(v) => studio.updateSfx(doc.id, instId, { duration: v })} /></Row>
        <Row label="gain"><Slider value={s.gain} min={0} max={1.5} step={0.05} onChange={(v) => studio.updateSfx(doc.id, instId, { gain: v })} /></Row>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Btn onClick={() => studio.addSfx(doc.id, s.sfx, s.start + 0.5)}><Plus size={11} /> Add cue</Btn>
          <Btn tone="red" onClick={() => studio.deleteSfx(doc.id, instId)}><Trash2 size={11} /> Delete</Btn>
        </div>
        <Preserved note="Sound cues are independent assets — replacing one changes nothing else." />
      </div>
    </div>
  );
}

/* ---- CAMERA ---- */

function CameraPanel({ doc }: { doc: SceneDocument }) {
  const c = doc.camera;
  return (
    <div>
      <Head icon={Camera} title="Camera layer" sub={c.auto ? "auto (from match event)" : "manual"} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {CAMERA_MOVES.map((m) => (
            <button key={m} onClick={() => studio.updateCamera(doc.id, { move: m })}
              className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${c.move === m ? "border-violet/50 bg-violet/10 text-violet" : "border-white/10 text-dim hover:text-bone"}`}>
              {m}
            </button>
          ))}
        </div>
        <Row label="intensity"><Slider value={c.intensity} min={0.3} max={1.4} step={0.05} onChange={(v) => studio.updateCamera(doc.id, { intensity: v })} /></Row>
        <Row label="shake">
          <Btn tone={c.shake_enabled ? "green" : "ghost"} onClick={() => studio.updateCamera(doc.id, { shake_enabled: !c.shake_enabled })}>
            {c.shake_enabled ? "on" : "off"}
          </Btn>
        </Row>
        <Row label="focus">
          <select value={c.focus_character_id ?? ""} onChange={(e) => studio.setFocusCharacter(doc.id, e.target.value)}
            className="min-w-0 flex-1 rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9px] text-bone outline-none">
            <option value="">— centre —</option>
            {doc.characters.map((ch) => {
              const sc = sportsCharacter(ch.character_id);
              return <option key={ch.character_id} value={ch.character_id}>{sc?.name ?? ch.character_id}</option>;
            })}
          </select>
        </Row>
        {c.focus_point ? (
          <>
            <Row label="focus x"><Slider value={c.focus_point.x} min={0.1} max={0.9} step={0.01} onChange={(v) => studio.updateCamera(doc.id, { focus_point: { x: v, y: c.focus_point!.y } })} /></Row>
            <Row label="focus y"><Slider value={c.focus_point.y} min={0.1} max={0.9} step={0.01} onChange={(v) => studio.updateCamera(doc.id, { focus_point: { x: c.focus_point!.x, y: v } })} /></Row>
          </>
        ) : (
          <p className="py-1 font-mono text-[8.5px] text-faint">No focal metadata — using a safe centre framing.</p>
        )}
        <div className="mt-2"><Btn onClick={() => studio.resetCamera(doc.id)}><Undo2 size={11} /> Reset to auto</Btn></div>
        <Preserved note="Camera is a pure instruction layer — it never rasterizes into the artwork." />
      </div>
    </div>
  );
}

function TransitionPanel({ doc }: { doc: SceneDocument }) {
  return (
    <div>
      <Head icon={Film} title="Transition" sub={`out of P${doc.panel_number}`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {TRANSITIONS.map((t) => (
            <button key={t} onClick={() => studio.updateTransition(doc.id, t)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${doc.transition.kind === t ? "border-ember/50 bg-ember/10 text-ember" : "border-white/10 text-dim hover:text-bone"}`}>{t}</button>
          ))}
        </div>
        <Row label="duration"><Slider value={doc.transition.duration} min={0.1} max={1.5} step={0.05} onChange={(v) => studio.updateTransition(doc.id, doc.transition.kind, v)} /></Row>
        <Preserved note="Transitions are timeline instructions, applied at export." />
      </div>
    </div>
  );
}

function MusicPanel({ doc }: { doc: SceneDocument }) {
  const f = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Head icon={Music4} title="Music bed" sub={doc.music.enabled ? doc.music.label : "disabled"} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <Btn tone={doc.music.enabled ? "green" : "ghost"} onClick={() => studio.updateMusic(doc.id, { enabled: !doc.music.enabled })}>
            {doc.music.enabled ? "enabled" : "disabled"}
          </Btn>
          <Btn onClick={() => f.current?.click()}><Upload size={11} /> Load track</Btn>
        </div>
        <input ref={f} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && studio.attachMusic(doc.id, e.target.files[0])} />
        <Row label="gain"><Slider value={doc.music.gain} min={0} max={0.8} step={0.02} onChange={(v) => studio.updateMusic(doc.id, { gain: v })} /></Row>
        <Row label="fade in"><Slider value={doc.music.fade_in} min={0} max={5} step={0.1} onChange={(v) => studio.updateMusic(doc.id, { fade_in: v })} /></Row>
        <Row label="fade out"><Slider value={doc.music.fade_out} min={0} max={5} step={0.1} onChange={(v) => studio.updateMusic(doc.id, { fade_out: v })} /></Row>
        <p className="mt-2 font-mono text-[8.5px] leading-relaxed text-faint">
          No commercial music ships with BRYME. Load a track you have the rights to.
        </p>
      </div>
    </div>
  );
}

/* ---- CHARACTER / SPORTS BIBLE ---- */

function CharacterPanel({ doc, charId }: { doc: SceneDocument; charId: string }) {
  const [team, setTeam] = useState(SQUAD_TEAMS[0].id);
  const c = sportsCharacter(charId);
  return (
    <div>
      <Head icon={Users} title="Sports Bible" sub={`${doc.characters.length} attached to this scene`} onClose={() => studio.select({ kind: "none" })} />
      <div className="p-3">
        {c && (
          <div className="mb-3 rounded border border-white/[0.07] bg-white/[0.02] p-2">
            <p className="text-[12px] font-bold text-bone">{c.name} {c.squad_number ? <span className="text-faint">#{c.squad_number}</span> : null}</p>
            <p className="mb-1.5 font-mono text-[8.5px] text-faint">{c.id} · {c.position.replace(/_/g, " ")}</p>
            {[["face", c.face], ["hair", c.hair], ["skin", c.skin_tone], ["body", c.body], ["kit", c.kit]].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[46px_1fr] gap-2 border-b border-white/[0.04] py-0.5 last:border-none">
                <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-faint">{k}</span>
                <span className="text-[10px] leading-relaxed text-bone/75">{v}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.2em] text-faint">attached</p>
        <div className="mb-2 flex flex-wrap gap-1">
          {doc.characters.map((ch) => {
            const sc = sportsCharacter(ch.character_id);
            return (
              <button key={ch.character_id} onClick={() => studio.select({ kind: "character", scene: doc.id, id: ch.character_id })}
                className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${ch.character_id === charId ? "border-city/50 bg-city/10 text-city" : "border-white/10 text-dim"}`}>
                {sc?.name ?? ch.character_id}
                <X size={9} onClick={(e) => { e.stopPropagation(); studio.removeCharacter(doc.id, ch.character_id); }} className="hover:text-claret" />
              </button>
            );
          })}
        </div>
        <div className="mb-1.5 flex gap-1">
          {SQUAD_TEAMS.map((t) => (
            <button key={t.id} onClick={() => setTeam(t.id)}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${team === t.id ? "border-fairway/40 bg-fairway/10 text-fairway" : "border-white/10 text-dim"}`}>
              <span className="h-2 w-2 rounded-sm" style={{ background: t.swatch[0] }} /> {t.short}
            </button>
          ))}
          <button onClick={() => setTeam("neutral")}
            className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] ${team === "neutral" ? "border-fairway/40 bg-fairway/10 text-fairway" : "border-white/10 text-dim"}`}>OFF</button>
        </div>
        <div className="max-h-40 space-y-0.5 overflow-y-auto code-scroll">
          {(team === "neutral" ? SPORTS_BIBLE.filter((s) => !s.team_id) : squadFor(team)).map((s) => (
            <button key={s.id} onClick={() => studio.addCharacter(doc.id, s.id)}
              className="flex w-full items-center gap-2 rounded border border-white/[0.06] px-1.5 py-1 text-left hover:border-city/40">
              <span className="w-5 shrink-0 font-mono text-[9px] text-faint">{s.squad_number ?? "—"}</span>
              <span className="truncate text-[10px] text-bone/80">{s.name}</span>
              <Plus size={10} className="ml-auto shrink-0 text-faint" />
            </button>
          ))}
        </div>
        <Preserved note="Sports Bible IDs are stable — the same player keeps the same face across all 26 panels." />
      </div>
    </div>
  );
}

export { Download };

