import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ASPECTS, type AspectSpec, type MotionTimeline, type Scene, type TimelineElement } from "../../engine/motion/types";
import { easeOutBack, sampleCamera, sceneAt, shakeOffset } from "../../engine/motion/timeline";
import { studio, type BubbleLayer, type SceneDocument } from "../../engine/motion/studio";
import { applyMix, audioStream, duck, initAudio, playSfx, stopSpeech } from "../../engine/motion/audio";

export interface StageHandle {
  exportVideo: (onProgress: (pct: number, scene: number) => void) => Promise<{ url: string; bytes: number; mime: string }>;
}

interface Props {
  timeline: MotionTimeline;
  docs: SceneDocument[];
  aspect: AspectSpec["id"];
  time: number;
  playing: boolean;
  showSafe: boolean;
  showBoxes: boolean;
  muted: boolean;
  selectedBubble: string | null;
  /** When true (paused), every bubble in the current scene is visible and draggable. */
  editMode?: boolean;
  cinematic?: boolean;
  onTime: (t: number) => void;
  onEnded: () => void;
  onPickBubble: (sceneId: string, bubbleId: string | null) => void;
  onMoveBubble: (sceneId: string, bubbleId: string, x: number, y: number) => void;
  onResizeBubble: (sceneId: string, bubbleId: string, width: number) => void;
  onEditText?: (sceneId: string, bubbleId: string, text: string) => void;
}

interface HitBox {
  bubbleId: string;
  sceneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONTS = {
  display: '"Space Grotesk", system-ui, sans-serif',
  mono: '"JetBrains Mono", monospace',
  comic: '"Comic Sans MS", "Chalkboard SE", "Space Grotesk", sans-serif',
};

const StageCanvas = forwardRef<StageHandle, Props>(function StageCanvas(
  {
    timeline, docs, aspect, time, playing, showSafe, showBoxes, muted, selectedBubble,
    editMode = true, cinematic = true,
    onTime, onEnded, onPickBubble, onMoveBubble, onResizeBubble, onEditText,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const fired = useRef(new Set<string>());
  const players = useRef(new Map<string, HTMLAudioElement>());
  const hitboxes = useRef<HitBox[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const tRef = useRef(time);
  const drag = useRef<{ id: string; scene: string; mode: "move" | "resize"; dx: number; dy: number } | null>(null);
  const dragPos = useRef<{ id: string; x: number; y: number; width?: number } | null>(null);
  const drawRef = useRef<(t: number) => void>(() => undefined);
  const [cursor, setCursor] = useState<"default" | "grab" | "grabbing" | "ew-resize">("default");
  const [editing, setEditing] = useState<{
    sceneId: string; bubbleId: string; text: string; left: number; top: number; width: number; height: number;
  } | null>(null);
  const spec = ASPECTS[aspect];
  tRef.current = time;

  const sources = useMemo(() => {
    const s = new Set<string>();
    timeline.scenes.forEach((sc) => sc.image_url && s.add(sc.image_url));
    docs.forEach((d) => d.image.current.url && s.add(d.image.current.url));
    return [...s];
  }, [timeline, docs]);

  useEffect(() => {
    sources.forEach((src) => {
      if (images.current.has(src)) return;
      const img = new Image();
      img.onload = () => drawRef.current(tRef.current);
      img.src = src;
      images.current.set(src, img);
    });
  }, [sources]);

  const applyDrag = (layer: BubbleLayer): BubbleLayer => {
    const d = dragPos.current;
    if (!d || d.id !== layer.id) return layer;
    return { ...layer, x: d.x, y: d.y, width: d.width ?? layer.width };
  };

  const draw = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      hitboxes.current = [];

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#050607";
      ctx.fillRect(0, 0, W, H);

      const found = sceneAt(timeline, t);
      if (!found) return;
      const { scene, local } = found;
      const doc = docs.find((d) => d.id === scene.id);

      const camEl = scene.elements.find((e) => e.type === "camera");
      const cam = camEl?.camera ? sampleCamera(camEl.camera, local) : { scale: 1.08, x: 0.5, y: 0.5 };
      const jit = camEl?.camera ? shakeOffset(camEl.camera, local) : { dx: 0, dy: 0 };

      const imgUrl = doc?.image.current.url || scene.image_url;
      const img = imgUrl ? images.current.get(imgUrl) : undefined;
      if (img?.complete && img.naturalWidth) {
        drawCropped(ctx, img, W, H, cam, jit);
      } else {
        ctx.fillStyle = "#12160F";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#6A7368";
        ctx.font = '600 18px "Space Grotesk", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(imgUrl ? "Loading the frame…" : "Drop an image onto this scene", W / 2, H / 2);
      }

      if (cinematic) paintVignette(ctx, W, H);

      const trans = scene.elements.find((e) => e.type === "transition");
      if (trans && local >= trans.start && playing) {
        paintTransition(ctx, W, H, trans.transition ?? "crossfade", (local - trans.start) / Math.max(0.001, trans.end - trans.start));
      }
      const idx = timeline.scenes.findIndex((s) => s.id === scene.id);
      if (playing && idx > 0 && local < 0.35) {
        paintTransition(ctx, W, H, timeline.scenes[idx - 1].transition_out, 1 - local / 0.35, true);
      }

      const editingNow = editMode && !playing;

      if (doc) {
        for (const layer of doc.bubbles) {
          if (!layer.visible) continue;
          const el = scene.elements.find((e) => e.id === layer.id);
          const line = doc.dialogue.find((l) => l.bubble_id === layer.id);
          const live = el ? local >= el.start && local <= el.end : false;
          const selected = selectedBubble === layer.id;
          if (!editingNow && !live && !selected && !showBoxes) continue;
          const ghost = !editingNow && !live && !selected;
          const fake: TimelineElement = el ?? {
            id: layer.id,
            type: "speech_bubble",
            start: 0,
            end: 99,
            speaker: line?.speaker_label,
            text: line?.text ?? "",
            bubble_style: layer.style,
            anim_in: layer.anim_in,
            anim_out: layer.anim_out,
          };
          const painted = paintBubble(
            ctx,
            { ...fake, text: line?.text ?? fake.text, speaker: line?.speaker_label ?? fake.speaker },
            applyDrag(layer),
            local,
            W, H, spec,
            editingNow || live,
            selected,
            ghost,
            editingNow
          );
          if (painted) hitboxes.current.push({ bubbleId: layer.id, sceneId: scene.id, ...painted });
        }
      }

      if (cinematic) {
        paintLetterbox(ctx, W, H);
        paintLowerThird(ctx, W, H, scene, doc);
      }
      if (showSafe) paintSafe(ctx, W, H, spec);
    },
    [timeline, docs, spec, showSafe, showBoxes, selectedBubble, editMode, playing, cinematic]
  );

  drawRef.current = draw;

  const fireAudio = useCallback(
    (scene: Scene, local: number) => {
      if (muted) return;
      const doc = docs.find((d) => d.id === scene.id);
      for (const el of scene.elements) {
        if (el.type !== "audio" && el.type !== "sfx") continue;
        const key = `${scene.id}:${el.id}`;
        if (fired.current.has(key)) continue;
        if (local < el.start || local > el.start + 0.4) continue;
        fired.current.add(key);

        if (el.type === "sfx" && el.sfx) {
          playSfx(el.sfx, el.gain ?? 1);
          continue;
        }
        const line = doc?.dialogue.find((l) => l.id === el.dialogue_id);
        const voice = line ? doc?.voices[line.id] : undefined;
        if (!line || !voice) continue;

        duck(0.4, 420);
        if (voice.url) {
          const a = new Audio(voice.url);
          a.volume = Math.max(0, Math.min(1, voice.gain));
          a.playbackRate = Math.max(0.5, Math.min(2, voice.speed));
          players.current.set(key, a);
          void a.play().catch(() => undefined);
        } else {
          studio.speakDialogue(scene.id, line.id);
        }
      }
    },
    [docs, muted]
  );

  const hush = useCallback(() => {
    stopSpeech();
    players.current.forEach((a) => a.pause());
    players.current.clear();
  }, []);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    void initAudio().then(() => applyMix({ voice_gain: 1, sfx_gain: 0.85, music_gain: 0, music_enabled: false, duck_sfx_under_voice: true }));

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.12, (now - last.current) / 1000);
      last.current = now;
      const next = tRef.current + dt;
      if (next >= timeline.duration) {
        onTime(timeline.duration);
        draw(Math.max(0, timeline.duration - 0.001));
        hush();
        onEnded();
        return;
      }
      tRef.current = next;
      onTime(next);
      draw(next);
      const f = sceneAt(timeline, next);
      if (f) fireAudio(f.scene, f.local);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, timeline, draw, fireAudio, onTime, onEnded, hush]);

  useEffect(() => {
    if (!playing) draw(time);
  }, [time, playing, draw]);

  const prev = useRef(time);
  useEffect(() => {
    if (Math.abs(time - prev.current) > 0.4) {
      fired.current.clear();
      hush();
    }
    prev.current = time;
  }, [time, hush]);

  useEffect(() => () => hush(), [hush]);

  const toLocal = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const hitTest = (px: number, py: number) => {
    for (let i = hitboxes.current.length - 1; i >= 0; i--) {
      const b = hitboxes.current[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (playing || editing) return;
    const { x, y } = toLocal(e);
    const hit = hitTest(x, y);
    if (!hit) {
      onPickBubble("", null);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onPickBubble(hit.sceneId, hit.bubbleId);
    const onHandle = x > hit.x + hit.w - 22 && y > hit.y + hit.h - 22;
    const doc = docs.find((d) => d.id === hit.sceneId);
    const layer = doc?.bubbles.find((b) => b.id === hit.bubbleId);
    drag.current = {
      id: hit.bubbleId,
      scene: hit.sceneId,
      mode: onHandle ? "resize" : "move",
      dx: x - (hit.x + hit.w / 2),
      dy: y - (hit.y + hit.h / 2),
    };
    dragPos.current = { id: hit.bubbleId, x: layer?.x ?? 0.5, y: layer?.y ?? 0.25, width: layer?.width };
    setCursor(onHandle ? "ew-resize" : "grabbing");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c || playing) return;
    const { x, y } = toLocal(e);
    if (!drag.current) {
      const hit = hitTest(x, y);
      setCursor(hit ? (x > hit.x + hit.w - 22 && y > hit.y + hit.h - 22 ? "ew-resize" : "grab") : "default");
      return;
    }
    const d = drag.current;
    if (d.mode === "move") {
      dragPos.current = {
        id: d.id,
        x: clamp01((x - d.dx) / c.width),
        y: clamp01((y - d.dy) / c.height),
        width: dragPos.current?.width,
      };
    } else {
      const box = hitboxes.current.find((b) => b.bubbleId === d.id);
      if (box) {
        const w = Math.max(0.18, Math.min(0.9, (x - box.x) / c.width));
        dragPos.current = { id: d.id, x: dragPos.current?.x ?? 0.5, y: dragPos.current?.y ?? 0.25, width: w };
      }
    }
    draw(tRef.current);
  };

  const onPointerUp = () => {
    const d = drag.current;
    const pos = dragPos.current;
    if (d && pos) {
      if (d.mode === "move") onMoveBubble(d.scene, d.id, pos.x, pos.y);
      else if (pos.width != null) onResizeBubble(d.scene, d.id, pos.width);
    }
    drag.current = null;
    dragPos.current = null;
    setCursor("default");
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (playing || !onEditText) return;
    const c = canvasRef.current;
    const wrap = wrapRef.current;
    if (!c || !wrap) return;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const hit = hitTest(x, y);
    if (!hit) return;
    const doc = docs.find((d) => d.id === hit.sceneId);
    const line = doc?.dialogue.find((l) => l.bubble_id === hit.bubbleId);
    const wr = wrap.getBoundingClientRect();
    setEditing({
      sceneId: hit.sceneId,
      bubbleId: hit.bubbleId,
      text: line?.text ?? "",
      left: (hit.x / c.width) * wr.width,
      top: (hit.y / c.height) * wr.height,
      width: Math.max(140, (hit.w / c.width) * wr.width),
      height: Math.max(44, (hit.h / c.height) * wr.height),
    });
    onPickBubble(hit.sceneId, hit.bubbleId);
  };

  const commitEdit = () => {
    if (!editing) return;
    onEditText?.(editing.sceneId, editing.bubbleId, editing.text);
    setEditing(null);
  };

  useImperativeHandle(ref, () => ({
    exportVideo: async (onProgress) => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("stage not mounted");
      await initAudio();
      const vs = canvas.captureStream(timeline.fps);
      const as = audioStream();
      const stream = new MediaStream([...vs.getVideoTracks(), ...(as ? as.getAudioTracks() : [])]);
      const mime = pickMime();
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
      const done = new Promise<{ url: string; bytes: number; mime: string }>((resolve) => {
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mime });
          resolve({ url: URL.createObjectURL(blob), bytes: blob.size, mime });
        };
      });

      rec.start(250);
      fired.current.clear();
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const t = Math.min(timeline.duration, (performance.now() - t0) / 1000);
          draw(t);
          const f = sceneAt(timeline, t);
          if (f) {
            fireAudio(f.scene, f.local);
            onProgress((t / timeline.duration) * 100, f.scene.panel_number);
          }
          if (t >= timeline.duration) return resolve();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      await new Promise((r) => setTimeout(r, 300));
      rec.stop();
      hush();
      return done;
    },
  }));

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        width={Math.round(spec.width / 2)}
        height={Math.round(spec.height / 2)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ cursor: playing ? "default" : cursor }}
        className="h-full w-full touch-none object-contain"
      />
      {editing && (
        <textarea
          autoFocus
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            }
          }}
          className="absolute z-10 resize-none rounded-md border-2 border-fairway bg-[#F7F5EF] p-2 text-[13px] font-semibold leading-snug text-[#12140F] shadow-xl outline-none"
          style={{ left: editing.left, top: editing.top, width: editing.width, minHeight: editing.height }}
        />
      )}
      {editMode && !playing && !editing && (
        <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-center">
          <span className="rounded-full bg-black/70 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-bone/80">
            Drag a bubble · double-click to rewrite the line
          </span>
        </div>
      )}
    </div>
  );
});

export default StageCanvas;

function clamp01(v: number) {
  return Math.max(0.06, Math.min(0.94, v));
}

function drawCropped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  cam: { scale: number; x: number; y: number },
  jit: { dx: number; dy: number }
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const target = W / H;
  let cw = iw;
  let chh = cw / target;
  if (chh > ih) {
    chh = ih;
    cw = chh * target;
  }
  cw /= cam.scale;
  chh /= cam.scale;
  let sx = (cam.x + jit.dx) * iw - cw / 2;
  let sy = (cam.y + jit.dy) * ih - chh / 2;
  sx = Math.max(0, Math.min(iw - cw, sx));
  sy = Math.max(0, Math.min(ih - chh, sy));
  ctx.drawImage(img, sx, sy, cw, chh, 0, 0, W, H);
}

function paintVignette(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function paintLetterbox(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const bar = Math.round(H * 0.065);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
}

function paintLowerThird(ctx: CanvasRenderingContext2D, W: number, H: number, scene: Scene, doc?: SceneDocument) {
  const bar = H * 0.065;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, H - bar - 36, W * 0.46, 28);
  ctx.fillStyle = "#3DD68C";
  ctx.fillRect(0, H - bar - 36, 3, 28);
  ctx.fillStyle = "#EEF2EA";
  ctx.font = '700 13px "Space Grotesk", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const minute = (doc as SceneDocument & { event_type?: string })?.event_type ? String(scene.event_type ?? "").replace(/_/g, " ") : "";
  ctx.fillText(`S${String(scene.panel_number).padStart(2, "0")}  ${scene.title}`, 12, H - bar - 22);
  if (minute) {
    ctx.fillStyle = "#6CB4EE";
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillText(minute.toUpperCase(), 12, H - bar - 10);
  }
  ctx.restore();
}

function paintTransition(ctx: CanvasRenderingContext2D, W: number, H: number, kind: string, p: number, incoming = false) {
  const k = Math.max(0, Math.min(1, p));
  if (kind === "dip_to_black") ctx.fillStyle = `rgba(4,6,5,${k})`;
  else if (kind === "flash") ctx.fillStyle = `rgba(255,252,240,${k * (incoming ? 0.5 : 0.72)})`;
  else if (kind === "whip_pan") ctx.fillStyle = `rgba(6,8,7,${k * 0.5})`;
  else ctx.fillStyle = `rgba(7,9,8,${k * 0.8})`;
  ctx.fillRect(0, 0, W, H);
}

function paintSafe(ctx: CanvasRenderingContext2D, W: number, H: number, spec: AspectSpec) {
  const s = spec.safe;
  ctx.save();
  ctx.fillStyle = "rgba(255,90,90,0.10)";
  ctx.fillRect(0, 0, W, H * s.top);
  ctx.fillRect(0, H * (1 - s.bottom), W, H * s.bottom);
  ctx.fillRect(0, 0, W * s.left, H);
  ctx.fillRect(W * (1 - s.right), 0, W * s.right, H);
  ctx.strokeStyle = "rgba(108,180,238,0.55)";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(W * s.left, H * s.top, W * (1 - s.left - s.right), H * (1 - s.top - s.bottom));
  ctx.setLineDash([]);
  ctx.restore();
}

function paintBubble(
  ctx: CanvasRenderingContext2D,
  el: TimelineElement,
  layer: BubbleLayer,
  local: number,
  W: number,
  H: number,
  _spec: AspectSpec,
  live: boolean,
  selected: boolean,
  ghost: boolean,
  editMode = false
): { x: number; y: number; w: number; h: number } | null {
  void _spec;
  const IN = 0.28;
  const OUT = 0.22;
  const inP = live && !editMode ? Math.min(1, (local - el.start) / IN) : 1;
  const outStart = el.end - OUT;
  const outP = live && !editMode && local > outStart ? Math.min(1, (local - outStart) / OUT) : 0;

  let scale = 1;
  let alpha = 1;
  let dx = 0;
  let dy = 0;
  if (live && !editMode) {
    switch (layer.anim_in) {
      case "pop_in": scale = 0.86 + 0.14 * easeOutBack(inP); alpha = Math.min(1, inP * 1.6); break;
      case "bounce_in": scale = 0.9 + 0.1 * easeOutBack(inP); dy = (1 - easeOutBack(inP)) * -16; alpha = Math.min(1, inP * 1.8); break;
      case "slide_in": dy = (1 - inP) * 24; alpha = inP; break;
      case "shake_in": alpha = Math.min(1, inP * 2); dx = inP < 1 ? Math.sin(inP * 34) * (1 - inP) * 8 : 0; scale = 0.94 + 0.06 * inP; break;
      default: alpha = inP;
    }
    if (outP > 0) {
      if (layer.anim_out === "pop_out") scale *= 1 - 0.12 * outP;
      alpha *= 1 - outP;
    }
  }
  if (ghost) alpha = 0.28;
  if (alpha <= 0.02 && !selected) return null;

  const ref = W / 960;
  const fontSize = Math.round(20 * layer.font_scale * ref * 1.05);
  ctx.font = `600 ${fontSize}px ${FONTS[layer.font_family]}`;
  const maxW = W * layer.width;
  const lines = wrap(ctx, el.text ?? "", maxW);
  const lineH = fontSize * 1.32;
  const padX = fontSize * 0.82;
  const padY = fontSize * 0.62;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), 30);
  const boxW = textW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;

  let cx = layer.x * W + dx;
  let cy = layer.y * H + dy;
  cx = Math.max(boxW / 2 + 8, Math.min(W - boxW / 2 - 8, cx));
  cy = Math.max(boxH / 2 + 18, Math.min(H - boxH / 2 - 18, cy));
  const bx = cx - boxW / 2;
  const by = cy - boxH / 2;

  ctx.save();
  ctx.globalAlpha = Math.max(0.06, alpha);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-boxW / 2, -boxH / 2);

  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 16 * ref;
  ctx.shadowOffsetY = 5 * ref;
  const r = layer.style === "narration" || layer.style === "commentator" ? 5 * ref : 15 * ref;
  ctx.fillStyle = layer.fill;
  ctx.strokeStyle = selected ? "#3DD68C" : layer.stroke;
  ctx.lineWidth = Math.max(1.6, (selected ? 3 : 2.2) * ref);
  if (layer.style === "shout") spiky(ctx, boxW, boxH, 12 * ref);
  else rounded(ctx, 0, 0, boxW, boxH, r);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (layer.style === "whisper") ctx.setLineDash([5 * ref, 4 * ref]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (layer.style === "narration" || layer.style === "commentator") {
    ctx.fillStyle = layer.stroke;
    ctx.fillRect(0, 0, 4 * ref, boxH);
  }
  if (layer.style === "speech" || layer.style === "shout" || layer.style === "whisper") {
    const tx = boxW * (layer.x > 0.5 ? 0.68 : 0.32);
    ctx.beginPath();
    ctx.moveTo(tx - 9 * ref, boxH - 1);
    ctx.lineTo(tx + 8 * ref, boxH - 1);
    ctx.lineTo(tx + (layer.x > 0.5 ? 18 : -18) * ref, boxH + 17 * ref);
    ctx.closePath();
    ctx.fillStyle = layer.fill;
    ctx.fill();
    ctx.stroke();
  }
  if (el.speaker && (layer.style === "speech" || layer.style === "shout" || layer.style === "commentator")) {
    const lf = Math.round(fontSize * 0.48);
    ctx.font = `700 ${lf}px ${FONTS.mono}`;
    const label = el.speaker.toUpperCase();
    const lw = ctx.measureText(label).width + 12 * ref;
    ctx.fillStyle = selected ? "#3DD68C" : layer.stroke;
    rounded(ctx, padX * 0.35, -9 * ref, lw, 16 * ref, 4 * ref);
    ctx.fill();
    ctx.fillStyle = layer.fill;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padX * 0.35 + 6 * ref, -1 * ref);
  }

  ctx.font = `600 ${fontSize}px ${FONTS[layer.font_family]}`;
  ctx.fillStyle = layer.text_color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, padX, padY + i * lineH));
  ctx.restore();

  if (selected) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#3DD68C";
    ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(bx - 4, by - 4, boxW + 8, boxH + 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#3DD68C";
    ctx.fillRect(bx + boxW - 6, by + boxH - 6, 14, 14);
    ctx.strokeStyle = "#0B0E0C";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + boxW + 2, by + boxH - 2);
    ctx.lineTo(bx + boxW + 8, by + boxH + 8);
    ctx.stroke();
    ctx.restore();
  }

  return { x: bx, y: by, w: boxW, h: boxH };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function spiky(ctx: CanvasRenderingContext2D, w: number, h: number, spike: number) {
  const pts = 18;
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? 1 : 0.88;
    const x = w / 2 + Math.cos(a) * (w / 2 + (i % 2 === 0 ? spike * 0.35 : 0)) * rad;
    const y = h / 2 + Math.sin(a) * (h / 2 + (i % 2 === 0 ? spike * 0.5 : 0)) * rad;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function pickMime(): string {
  for (const c of [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}
