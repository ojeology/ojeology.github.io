import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ASPECTS, type AspectSpec, type MotionTimeline, type Scene, type TimelineElement } from "../../engine/motion/types";
import { easeOutBack, sampleCamera, sceneAt, shakeOffset } from "../../engine/motion/timeline";
import { studio, type BubbleLayer, type SceneDocument } from "../../engine/motion/studio";
import { applyMix, audioStream, duck, initAudio, playSfx, speakLine, stopSpeech } from "../../engine/motion/audio";

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
  onTime: (t: number) => void;
  onEnded: () => void;
  onPickBubble: (sceneId: string, bubbleId: string | null) => void;
  onMoveBubble: (sceneId: string, bubbleId: string, x: number, y: number) => void;
  onResizeBubble: (sceneId: string, bubbleId: string, width: number) => void;
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
    onTime, onEnded, onPickBubble, onMoveBubble, onResizeBubble,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const fired = useRef(new Set<string>());
  const players = useRef(new Map<string, HTMLAudioElement>());
  const hitboxes = useRef<HitBox[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const tRef = useRef(time);
  const drag = useRef<{ id: string; scene: string; mode: "move" | "resize"; dx: number; dy: number } | null>(null);
  const [cursor, setCursor] = useState<"default" | "grab" | "grabbing" | "ew-resize">("default");
  const spec = ASPECTS[aspect];
  tRef.current = time;

  /* ---------- preload ---------- */
  const sources = useMemo(() => {
    const s = new Set<string>();
    timeline.scenes.forEach((sc) => sc.image_url && s.add(sc.image_url));
    return [...s];
  }, [timeline]);

  useEffect(() => {
    sources.forEach((src) => {
      if (images.current.has(src)) return;
      const img = new Image();
      img.src = src;
      images.current.set(src, img);
    });
  }, [sources]);

  /* ---------- draw ---------- */
  const draw = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      hitboxes.current = [];

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#07090A";
      ctx.fillRect(0, 0, W, H);

      const found = sceneAt(timeline, t);
      if (!found) return;
      const { scene, local } = found;
      const doc = docs.find((d) => d.id === scene.id);

      const camEl = scene.elements.find((e) => e.type === "camera");
      const cam = camEl?.camera ? sampleCamera(camEl.camera, local) : { scale: 1.05, x: 0.5, y: 0.5 };
      const jit = camEl?.camera ? shakeOffset(camEl.camera, local) : { dx: 0, dy: 0 };

      const img = scene.image_url ? images.current.get(scene.image_url) : undefined;
      if (img?.complete && img.naturalWidth) {
        drawCropped(ctx, img, W, H, cam, jit);
      } else {
        ctx.fillStyle = "#12160F";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#4A5348";
        ctx.font = '500 20px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillText(scene.image_url ? "loading artwork…" : "no image asset", W / 2, H / 2);
      }

      const trans = scene.elements.find((e) => e.type === "transition");
      if (trans && local >= trans.start) {
        paintTransition(ctx, W, H, trans.transition ?? "crossfade", (local - trans.start) / Math.max(0.001, trans.end - trans.start));
      }
      const idx = timeline.scenes.findIndex((s) => s.id === scene.id);
      if (idx > 0 && local < 0.35) {
        paintTransition(ctx, W, H, timeline.scenes[idx - 1].transition_out, 1 - local / 0.35, true);
      }

      for (const el of scene.elements) {
        if (el.type !== "speech_bubble") continue;
        const layer = doc?.bubbles.find((b) => b.id === el.id);
        if (!layer) continue;
        const live = local >= el.start && local <= el.end;
        const selected = selectedBubble === el.id;
        if (!live && !selected && !showBoxes) continue;
        const box = paintBubble(ctx, el, layer, local, W, H, spec, live, selected, !live);
        if (box) hitboxes.current.push({ bubbleId: el.id, sceneId: scene.id, ...box });
      }

      if (showSafe) paintSafe(ctx, W, H, spec);
    },
    [timeline, docs, spec, showSafe, showBoxes, selectedBubble]
  );

  /* ---------- audio ---------- */
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
          // real audio file — user upload, recording, or a provider that returns files
          const a = new Audio(voice.url);
          a.volume = Math.max(0, Math.min(1, voice.gain));
          a.playbackRate = Math.max(0.5, Math.min(2, voice.speed));
          players.current.set(key, a);
          void a.play().catch(() => undefined);
        } else if (voice.source === "ai") {
          speakLine(
            { ...line, voice_profile_id: voice.voice_profile_id ?? "vp-narrator", bubble_style: "speech", panel_id: scene.panel_id, order: line.order, priority: line.order, speaker_label: line.speaker_label, character_id: line.character_id, text: line.text, language_label: line.language_label, kind: "speech", emotion: line.emotion, id: line.id, speed_override: voice.speed, pitch_override: voice.pitch },
            (r) => !r.cancelled && studio.reportMeasured(scene.id, line.id, r.measured)
          );
        }
      }
    },
    [docs, muted]
  );

  const hush = useCallback(() => {
    stopSpeech();
    players.current.forEach((a) => {
      a.pause();
    });
    players.current.clear();
  }, []);

  /* ---------- loop ---------- */
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

  /* ---------- pointer interaction ---------- */
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
    const { x, y } = toLocal(e);
    const hit = hitTest(x, y);
    if (!hit) {
      onPickBubble("", null);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onPickBubble(hit.sceneId, hit.bubbleId);
    const onHandle = x > hit.x + hit.w - 18 && y > hit.y + hit.h - 18;
    drag.current = {
      id: hit.bubbleId,
      scene: hit.sceneId,
      mode: onHandle ? "resize" : "move",
      dx: x - (hit.x + hit.w / 2),
      dy: y - (hit.y + hit.h / 2),
    };
    setCursor(onHandle ? "ew-resize" : "grabbing");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c) return;
    const { x, y } = toLocal(e);
    if (!drag.current) {
      const hit = hitTest(x, y);
      setCursor(hit ? (x > hit.x + hit.w - 18 && y > hit.y + hit.h - 18 ? "ew-resize" : "grab") : "default");
      return;
    }
    const d = drag.current;
    if (d.mode === "move") {
      onMoveBubble(d.scene, d.id, clamp01((x - d.dx) / c.width), clamp01((y - d.dy) / c.height));
    } else {
      const box = hitboxes.current.find((b) => b.bubbleId === d.id);
      if (box) {
        const w = Math.max(0.15, Math.min(0.92, ((x - box.x) * 2) / c.width));
        onResizeBubble(d.scene, d.id, w);
      }
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setCursor("default");
  };

  /* ---------- export ---------- */
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
    <canvas
      ref={canvasRef}
      width={Math.round(spec.width / 2)}
      height={Math.round(spec.height / 2)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ cursor }}
      className="h-full w-full touch-none object-contain"
    />
  );
});

export default StageCanvas;

/* ================================ painters ==================== */

function clamp01(v: number) {
  return Math.max(0.04, Math.min(0.96, v));
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
  spec: AspectSpec,
  live: boolean,
  selected: boolean,
  ghost: boolean
): { x: number; y: number; w: number; h: number } | null {
  const IN = 0.28;
  const OUT = 0.22;
  const inP = live ? Math.min(1, (local - el.start) / IN) : 1;
  const outStart = el.end - OUT;
  const outP = live && local > outStart ? Math.min(1, (local - outStart) / OUT) : 0;

  let scale = 1;
  let alpha = 1;
  let dx = 0;
  let dy = 0;
  if (live) {
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
  if (ghost) alpha = 0.24;
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

  const s = spec.safe;
  let cx = layer.x * W + dx;
  let cy = layer.y * H + dy;
  cx = Math.max(W * s.left + boxW / 2, Math.min(W * (1 - s.right) - boxW / 2, cx));
  cy = Math.max(H * s.top + boxH / 2, Math.min(H * (1 - s.bottom) - boxH / 2, cy));
  const bx = cx - boxW / 2;
  const by = cy - boxH / 2;

  ctx.save();
  ctx.globalAlpha = Math.max(0.06, alpha);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-boxW / 2, -boxH / 2);

  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 14 * ref;
  ctx.shadowOffsetY = 5 * ref;
  const r = layer.style === "narration" || layer.style === "commentator" ? 5 * ref : 15 * ref;
  ctx.fillStyle = layer.fill;
  ctx.strokeStyle = layer.stroke;
  ctx.lineWidth = Math.max(1.6, 2.2 * ref);
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
    ctx.fillStyle = layer.stroke;
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
    ctx.fillRect(bx + boxW - 8, by + boxH - 8, 12, 12);
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

