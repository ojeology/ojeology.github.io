import { useRef, useState } from "react";
import {
  Camera, Copy, Film, Image as ImageIcon, MessageSquare, Mic, Music4, Plus,
  SquarePlay, Trash2, Users, Volume2,
} from "lucide-react";
import { studio, useStudio } from "../../engine/motion/studio";
import type { MotionTimeline } from "../../engine/motion/types";

type TrackKey = "image" | "characters" | "dialogue" | "voice" | "bubbles" | "sfx" | "music" | "camera" | "transition";

const TRACKS: { key: TrackKey; label: string; color: string; icon: typeof Camera; drag: boolean }[] = [
  { key: "image", label: "IMAGE", color: "#8B9DC3", icon: ImageIcon, drag: false },
  { key: "characters", label: "CHARS", color: "#E8C15A", icon: Users, drag: false },
  { key: "dialogue", label: "DIALOG", color: "#F0F0F0", icon: MessageSquare, drag: true },
  { key: "voice", label: "VOICE", color: "#3DD68C", icon: Mic, drag: true },
  { key: "bubbles", label: "BUBBLE", color: "#6CB4EE", icon: SquarePlay, drag: true },
  { key: "sfx", label: "SFX", color: "#E8C15A", icon: Volume2, drag: true },
  { key: "music", label: "MUSIC", color: "#A78BFA", icon: Music4, drag: false },
  { key: "camera", label: "CAMERA", color: "#A78BFA", icon: Camera, drag: false },
  { key: "transition", label: "TRANS", color: "#FF6A3D", icon: Film, drag: false },
];

interface Clip {
  id: string;
  sceneId: string;
  start: number;      // absolute seconds
  end: number;
  label: string;
  selected: boolean;
  onSelect: () => void;
  /** null = not draggable */
  onDrag: ((deltaSeconds: number) => void) | null;
  onTrim: ((deltaSeconds: number) => void) | null;
}

export default function TrackEditor({
  timeline, time, zoom, onSeek,
}: {
  timeline: MotionTimeline;
  time: number;
  zoom: number;
  onSeek: (t: number) => void;
}) {
  const state = useStudio();
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ clip: Clip; startX: number; mode: "move" | "trim"; pxPerSec: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; dx: number } | null>(null);

  const total = timeline.duration || 1;
  const widthPct = 100 * zoom;

  const pxPerSec = () => {
    const w = laneRef.current?.getBoundingClientRect().width ?? 1;
    return w / total;
  };

  const beginDrag = (e: React.PointerEvent, clip: Clip, mode: "move" | "trim") => {
    if (mode === "move" && !clip.onDrag) return;
    if (mode === "trim" && !clip.onTrim) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { clip, startX: e.clientX, mode, pxPerSec: pxPerSec() };
    clip.onSelect();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    setGhost({ id: drag.current.clip.id, dx });
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const delta = (e.clientX - d.startX) / d.pxPerSec;
      if (Math.abs(delta) > 0.01) {
        if (d.mode === "move") d.clip.onDrag?.(delta);
        else d.clip.onTrim?.(delta);
      }
    }
    drag.current = null;
    setGhost(null);
  };

  /* ---- build clips per track ---- */
  const clipsFor = (key: TrackKey): Clip[] => {
    const out: Clip[] = [];
    for (const scene of timeline.scenes) {
      const doc = state.project.scenes.find((s) => s.id === scene.id);
      if (!doc) continue;
      const slots = studio.timingFor(doc.id).slots;
      const sel = state.selection;

      const push = (c: Omit<Clip, "sceneId">) => out.push({ ...c, sceneId: scene.id });

      if (key === "image") {
        push({
          id: `${scene.id}-img`, start: scene.offset, end: scene.offset + scene.duration,
          label: doc.image.current.source, selected: sel.kind === "image" && sel.scene === scene.id,
          onSelect: () => studio.select({ kind: "image", scene: scene.id }), onDrag: null, onTrim: null,
        });
      }
      if (key === "characters") {
        const n = Math.max(1, doc.characters.length);
        doc.characters.forEach((c, i) => {
          push({
            id: `${scene.id}-ch${i}`,
            start: scene.offset + (scene.duration / n) * i,
            end: scene.offset + (scene.duration / n) * (i + 1),
            label: c.character_id.split("-").slice(1).join("-"),
            selected: sel.kind === "character" && sel.id === c.character_id,
            onSelect: () => studio.select({ kind: "character", scene: scene.id, id: c.character_id }),
            onDrag: null, onTrim: null,
          });
        });
      }
      if (key === "dialogue" || key === "voice") {
        for (const line of doc.dialogue) {
          const s = slots.find((x) => x.dialogue_id === line.id);
          if (!s) continue;
          const v = doc.voices[line.id];
          const isVoice = key === "voice";
          push({
            id: `${line.id}-${key}`,
            start: scene.offset + s.audio_start,
            end: scene.offset + s.audio_end,
            label: isVoice ? (v?.source === "silent" ? "no audio" : v?.source ?? "—") : line.text.slice(0, 24),
            selected: isVoice ? sel.kind === "voice" && sel.id === line.id : sel.kind === "dialogue" && sel.id === line.id,
            onSelect: () => studio.select(isVoice ? { kind: "voice", scene: scene.id, id: line.id } : { kind: "dialogue", scene: scene.id, id: line.id }),
            onDrag: (delta) => {
              if (isVoice) studio.updateVoice(scene.id, line.id, { offset: +((v?.offset ?? 0) + delta).toFixed(2) });
              else studio.pinDialogueStart(scene.id, line.id, Math.max(0, +(s.audio_start + delta).toFixed(2)));
            },
            onTrim: isVoice && v ? (delta) => studio.updateVoice(scene.id, line.id, { speed: clamp(v.speed * (v.duration / Math.max(0.2, v.duration + delta)), 0.5, 2) }) : null,
          });
        }
      }
      if (key === "bubbles") {
        for (const b of doc.bubbles) {
          const line = doc.dialogue.find((l) => l.bubble_id === b.id);
          const s = line ? slots.find((x) => x.dialogue_id === line.id) : null;
          if (!s) continue;
          push({
            id: `${b.id}-clip`,
            start: scene.offset + s.bubble_start,
            end: scene.offset + s.bubble_end,
            label: b.style,
            selected: sel.kind === "bubble" && sel.id === b.id,
            onSelect: () => studio.select({ kind: "bubble", scene: scene.id, id: b.id }),
            onDrag: (delta) => studio.updateBubble(scene.id, b.id, { lead: clamp(b.lead - delta, 0, 2) }, "bubble.retime"),
            onTrim: (delta) => studio.updateBubble(scene.id, b.id, { hold: clamp(b.hold + delta, 0, 4) }, "bubble.retime"),
          });
        }
      }
      if (key === "sfx") {
        for (const s of doc.sfx) {
          push({
            id: s.id,
            start: scene.offset + s.start,
            end: scene.offset + s.start + s.duration,
            label: s.label,
            selected: sel.kind === "sfx" && sel.id === s.id,
            onSelect: () => studio.select({ kind: "sfx", scene: scene.id, id: s.id }),
            onDrag: (delta) => studio.updateSfx(scene.id, s.id, { start: clamp(s.start + delta, 0, 30) }),
            onTrim: (delta) => studio.updateSfx(scene.id, s.id, { duration: clamp(s.duration + delta, 0.2, 30) }),
          });
        }
      }
      if (key === "music" && doc.music.enabled) {
        push({
          id: `${scene.id}-mus`, start: scene.offset + doc.music.start, end: scene.offset + scene.duration,
          label: doc.music.label, selected: sel.kind === "music" && sel.scene === scene.id,
          onSelect: () => studio.select({ kind: "music", scene: scene.id }), onDrag: null, onTrim: null,
        });
      }
      if (key === "camera") {
        push({
          id: `${scene.id}-cam`, start: scene.offset, end: scene.offset + scene.duration,
          label: doc.camera.move, selected: sel.kind === "camera" && sel.scene === scene.id,
          onSelect: () => studio.select({ kind: "camera", scene: scene.id }), onDrag: null, onTrim: null,
        });
      }
      if (key === "transition") {
        push({
          id: `${scene.id}-tr`,
          start: scene.offset + Math.max(0, scene.duration - doc.transition.duration),
          end: scene.offset + scene.duration,
          label: doc.transition.kind, selected: sel.kind === "transition" && sel.scene === scene.id,
          onSelect: () => studio.select({ kind: "transition", scene: scene.id }),
          onDrag: null,
          onTrim: (delta) => studio.updateTransition(scene.id, doc.transition.kind, clamp(doc.transition.duration + delta, 0.1, 1.5)),
        });
      }
    }
    return out;
  };

  return (
    <div className="overflow-x-auto code-scroll" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <div style={{ width: `${widthPct}%`, minWidth: "100%" }}>
        {/* scene ruler */}
        <div className="mb-1 flex items-center gap-1.5">
          <span className="w-[56px] shrink-0 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">SCENES</span>
          <div ref={laneRef} className="relative h-5 flex-1 overflow-hidden rounded bg-white/[0.03]">
            {timeline.scenes.map((s, i) => (
              <button key={s.id} onClick={() => onSeek(s.offset + 0.05)}
                className="absolute top-0 h-full border-r border-ink/70 transition-colors hover:bg-white/10"
                style={{
                  left: `${(s.offset / total) * 100}%`,
                  width: `${(s.duration / total) * 100}%`,
                  background: i % 2 ? "rgba(108,180,238,0.12)" : "rgba(61,214,140,0.12)",
                }}>
                <span className="pl-1 font-mono text-[8px] leading-5 text-bone/75">S{String(i + 1).padStart(2, "0")}</span>
              </button>
            ))}
            <Head time={time} total={total} />
          </div>
        </div>

        {TRACKS.map((track) => {
          const clips = clipsFor(track.key);
          return (
            <div key={track.key} className="mb-1 flex items-center gap-1.5">
              <span className="flex w-[56px] shrink-0 items-center gap-1 font-mono text-[8px] uppercase tracking-[0.12em] text-faint">
                <track.icon size={9} style={{ color: track.color }} /> {track.label}
              </span>
              <div className="relative h-[22px] flex-1 overflow-hidden rounded bg-white/[0.02]"
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onSeek(((e.clientX - r.left) / r.width) * total);
                }}>
                {clips.map((c) => {
                  const shift = ghost?.id === c.id ? ghost.dx : 0;
                  return (
                    <div
                      key={c.id}
                      onPointerDown={(e) => beginDrag(e, c, "move")}
                      title={`${c.label} · ${(c.end - c.start).toFixed(2)}s${c.onDrag ? " · drag to retime" : ""}`}
                      className="group absolute top-[3px] h-[16px] select-none overflow-hidden rounded-[3px] border transition-shadow"
                      style={{
                        left: `calc(${(c.start / total) * 100}% + ${shift}px)`,
                        width: `${Math.max(0.4, ((c.end - c.start) / total) * 100)}%`,
                        background: c.selected ? `${track.color}44` : `${track.color}22`,
                        borderColor: c.selected ? track.color : `${track.color}66`,
                        boxShadow: c.selected ? `0 0 0 1px ${track.color}` : undefined,
                        cursor: c.onDrag ? "grab" : "pointer",
                      }}
                    >
                      <span className="block truncate px-1 font-mono text-[7.5px] leading-4" style={{ color: track.color }}>
                        {c.label}
                      </span>
                      {c.onTrim && (
                        <span
                          onPointerDown={(e) => beginDrag(e, c, "trim")}
                          className="absolute right-0 top-0 h-full w-[7px] cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ background: track.color }}
                        />
                      )}
                    </div>
                  );
                })}
                <Head time={time} total={total} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Head({ time, total }: { time: number; total: number }) {
  return <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-ember" style={{ left: `${(time / total) * 100}%` }} />;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, +v.toFixed(3)));
}

/* ---------------- storyboard rail: scenario editing ---------------- */

export function SceneRail({ onSeek }: { onSeek: (t: number) => void }) {
  const state = useStudio();
  const file = useRef<HTMLInputElement>(null);
  const tl = state.timeline;

  return (
    <div className="flex gap-2 overflow-x-auto code-scroll p-2.5">
      {state.project.scenes.map((doc, i) => {
        const scene = tl.scenes.find((s) => s.id === doc.id);
        const active = state.selection.kind !== "none" && "scene" in state.selection && state.selection.scene === doc.id;
        return (
          <div key={doc.id}
            className={`group relative w-[132px] shrink-0 overflow-hidden rounded-lg border transition-colors ${active ? "border-city/60" : "border-white/10 hover:border-white/25"}`}>
            <button onClick={() => scene && onSeek(scene.offset + 0.05)} className="block w-full">
              {doc.image.current.url ? (
                <img src={doc.image.current.url} alt="" className="h-[74px] w-full object-cover" />
              ) : (
                <div className="grid h-[74px] w-full place-items-center bg-black/50 font-mono text-[8px] text-faint">no image</div>
              )}
            </button>
            <div className="px-1.5 py-1">
              <input
                value={doc.title}
                onChange={(e) => studio.updateSceneMeta(doc.id, { title: e.target.value })}
                className="w-full bg-transparent text-[10px] font-semibold text-bone outline-none focus:text-city"
              />
              <p className="font-mono text-[8px] text-faint">
                S{String(i + 1).padStart(2, "0")} · {scene?.duration.toFixed(1)}s · {doc.dialogue.length} lines
              </p>
            </div>
            <div className="flex items-center gap-0.5 border-t border-white/[0.06] px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Mini onClick={() => studio.moveScene(doc.id, -1)} title="move earlier">◀</Mini>
              <Mini onClick={() => studio.moveScene(doc.id, 1)} title="move later">▶</Mini>
              <Mini onClick={() => studio.duplicateScene(doc.id)} title="duplicate scene"><Copy size={9} /></Mini>
              <Mini onClick={() => studio.addDialogueLine(doc.id)} title="add dialogue"><MessageSquare size={9} /></Mini>
              <Mini onClick={() => studio.deleteScene(doc.id)} title="delete scene" danger><Trash2 size={9} /></Mini>
            </div>
          </div>
        );
      })}

      <button
        onClick={() => file.current?.click()}
        className="grid h-[118px] w-[112px] shrink-0 place-items-center rounded-lg border border-dashed border-white/15 text-faint transition-colors hover:border-fairway/50 hover:text-fairway"
      >
        <span className="text-center">
          <Plus size={16} className="mx-auto mb-1" />
          <span className="block font-mono text-[8.5px] uppercase tracking-[0.15em]">add scene</span>
          <span className="block font-mono text-[7.5px] text-faint">from image</span>
        </span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden multiple
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) await studio.addSceneFromImage(f);
          e.target.value = "";
        }} />
    </div>
  );
}

function Mini({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`grid h-4 flex-1 place-items-center rounded font-mono text-[8px] transition-colors ${danger ? "text-faint hover:bg-claret/20 hover:text-claret" : "text-faint hover:bg-white/10 hover:text-bone"}`}>
      {children}
    </button>
  );
}

