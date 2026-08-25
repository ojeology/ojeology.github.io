import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { ASPECTS, type AspectSpec, type Scene, type TimelineElement } from "../../engine/motion/types";
import { easeOutBack, sampleCamera, sceneAt, shakeOffset } from "../../engine/motion/timeline";
import { motion as motionEngine } from "../../engine/motion/runtime";
import { applyMix, duck, initAudio, playSfx, speakLine, stopSpeech, audioStream } from "../../engine/motion/audio";
import type { MotionTimeline } from "../../engine/motion/types";

export interface StageHandle {
  canvas: () => HTMLCanvasElement | null;
  record: (onProgress: (pct: number, panel: number) => void) => Promise<{ url: string; bytes: number; mime: string }>;
}

interface Props {
  timeline: MotionTimeline | null;
  aspect: AspectSpec["id"];
  time: number;
  playing: boolean;
  showSafe: boolean;
  letterbox: boolean;
  muted: boolean;
  onTime: (t: number) => void;
  onEnded: () => void;
}

const BUBBLE_FONT = '600 26px "Space Grotesk", system-ui, sans-serif';

const STYLE_SKIN: Record<string, { bg: string; fg: string; stroke: string; accent: string }> = {
  speech:      { bg: "#F7F5EF", fg: "#12140F", stroke: "#12140F", accent: "#6CB4EE" },
  shout:       { bg: "#FFE9C7", fg: "#20150A", stroke: "#20150A", accent: "#FF6A3D" },
  whisper:     { bg: "rgba(238,242,234,0.86)", fg: "#2A2F27", stroke: "#6C7268", accent: "#A78BFA" },
  thought:     { bg: "#EFF3FA", fg: "#171B22", stroke: "#3B4250", accent: "#A78BFA" },
  commentator: { bg: "#101410", fg: "#F2F6EE", stroke: "#3DD68C", accent: "#3DD68C" },
  narration:   { bg: "#14120C", fg: "#F5EEDC", stroke: "#E8C15A", accent: "#E8C15A" },
  crowd:       { bg: "rgba(12,16,12,0.82)", fg: "#EAF6E8", stroke: "#6CB4EE", accent: "#6CB4EE" },
};

const PreviewStage = forwardRef<StageHandle, Props>(function PreviewStage(
  { timeline, aspect, time, playing, showSafe, letterbox, muted, onTime, onEnded },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef<Map<string, HTMLImageElement>>(new Map());
  const fired = useRef<Set<string>>(new Set());
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const timeRef = useRef(time);
  const playingRef = useRef(playing);
  const spec = ASPECTS[aspect];

  timeRef.current = time;
  playingRef.current = playing;

  /* ---------------- preload artwork ---------------- */
  const sources = useMemo(() => {
    const s = new Set<string>();
    timeline?.scenes.forEach((sc) => sc.image_url && s.add(sc.image_url));
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

  /* ---------------- drawing ---------------- */

  const drawFrame = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !timeline) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#07090A";
      ctx.fillRect(0, 0, W, H);

      const found = sceneAt(timeline, t);
      if (!found) return;
      const { scene, local } = found;

      /* --- camera --- */
      const camEl = scene.elements.find((e) => e.type === "camera");
      const cam = camEl?.camera
        ? sampleCamera(camEl.camera, local)
        : { scale: 1.05, x: 0.5, y: 0.5 };
      const jitter = camEl?.camera ? shakeOffset(camEl.camera, local) : { dx: 0, dy: 0 };

      const img = scene.image_url ? images.current.get(scene.image_url) : undefined;
      if (img && img.complete && img.naturalWidth > 0) {
        drawCameraImage(ctx, img, W, H, cam, jitter, letterbox);
      } else {
        ctx.fillStyle = "#12160F";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#4A5348";
        ctx.font = '500 22px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillText("awaiting artwork", W / 2, H / 2);
      }

      /* --- transition (incoming + outgoing) --- */
      const trans = scene.elements.find((e) => e.type === "transition");
      if (trans && local >= trans.start) {
        const p = (local - trans.start) / Math.max(0.001, trans.end - trans.start);
        applyTransition(ctx, W, H, trans.transition ?? "crossfade", p);
      }
      // incoming half of the previous scene's transition
      const idx = timeline.scenes.findIndex((s) => s.id === scene.id);
      if (idx > 0 && local < 0.35) {
        const prev = timeline.scenes[idx - 1];
        applyTransition(ctx, W, H, prev.transition_out, 1 - local / 0.35, true);
      }

      /* --- bubbles --- */
      for (const el of scene.elements) {
        if (el.type !== "speech_bubble") continue;
        if (local < el.start || local > el.end) continue;
        drawBubble(ctx, el, local, W, H, spec);
      }

      /* --- safe zones --- */
      if (showSafe) drawSafeZones(ctx, W, H, spec);
    },
    [timeline, letterbox, showSafe, spec]
  );

  /* ---------------- audio triggers ---------------- */

  const fireAudio = useCallback(
    (scene: Scene, local: number) => {
      if (muted) return;
      for (const el of scene.elements) {
        if (el.type !== "audio" && el.type !== "sfx") continue;
        const key = `${scene.id}:${el.id}`;
        if (fired.current.has(key)) continue;
        if (local < el.start || local > el.start + 0.4) continue;
        fired.current.add(key);

        if (el.type === "sfx" && el.sfx) {
          playSfx(el.sfx, el.gain ?? 1);
        } else if (el.type === "audio" && el.dialogue_id) {
          const line = motionEngine.getState().lines.find((l) => l.id === el.dialogue_id);
          if (line) {
            duck(0.4, 400);
            speakLine(line, (r) => {
              if (!r.cancelled) motionEngine.reportMeasuredDuration(line.id, r.measured);
            });
          }
        }
      }
    },
    [muted]
  );

  /* ---------------- playback loop ---------------- */

  useEffect(() => {
    if (!playing || !timeline) return;
    lastFrame.current = performance.now();
    void initAudio().then(() => applyMix({ ...motionEngine.getState().project.audio, duck_sfx_under_voice: true }));

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.12, (now - lastFrame.current) / 1000);
      lastFrame.current = now;
      const next = timeRef.current + dt;

      if (next >= timeline.duration) {
        onTime(timeline.duration);
        drawFrame(timeline.duration - 0.001);
        stopSpeech();
        onEnded();
        return;
      }
      timeRef.current = next;
      onTime(next);
      drawFrame(next);
      const f = sceneAt(timeline, next);
      if (f) fireAudio(f.scene, f.local);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, timeline, drawFrame, fireAudio, onTime, onEnded]);

  /* redraw on scrub / config change while paused */
  useEffect(() => {
    if (!playing) drawFrame(time);
  }, [time, playing, drawFrame]);

  /* clear one-shot latches when the head jumps backwards */
  const prevTime = useRef(time);
  useEffect(() => {
    if (Math.abs(time - prevTime.current) > 0.5) {
      fired.current.clear();
      stopSpeech();
    }
    prevTime.current = time;
  }, [time]);

  useEffect(() => () => stopSpeech(), []);

  /* ---------------- imperative recording ---------------- */

  useImperativeHandle(ref, () => ({
    canvas: () => canvasRef.current,
    record: async (onProgress) => {
      const canvas = canvasRef.current;
      if (!canvas || !timeline) throw new Error("nothing to record");
      await initAudio();

      const fps = timeline.fps;
      const videoStream = canvas.captureStream(fps);
      const aStream = audioStream();
      const tracks = [...videoStream.getVideoTracks(), ...(aStream ? aStream.getAudioTracks() : [])];
      const combined = new MediaStream(tracks);

      const mime = pickMime();
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

      const done = new Promise<{ url: string; bytes: number; mime: string }>((resolve) => {
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mime });
          resolve({ url: URL.createObjectURL(blob), bytes: blob.size, mime });
        };
      });

      rec.start(250);
      fired.current.clear();

      // deterministic offline-style pass: advance the clock ourselves
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const step = () => {
          const elapsed = (performance.now() - started) / 1000;
          const t = Math.min(timeline.duration, elapsed);
          drawFrame(t);
          const f = sceneAt(timeline, t);
          if (f) {
            fireAudio(f.scene, f.local);
            onProgress((t / timeline.duration) * 100, f.scene.panel_number);
          }
          if (t >= timeline.duration) {
            resolve();
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

      await new Promise((r) => setTimeout(r, 260));
      rec.stop();
      stopSpeech();
      return done;
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      width={spec.width / 2}
      height={spec.height / 2}
      className="h-full w-full object-contain"
    />
  );
});

export default PreviewStage;

/* =============================== drawing helpers =============== */

function drawCameraImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  W: number,
  H: number,
  cam: { scale: number; x: number; y: number },
  jitter: { dx: number; dy: number },
  letterbox: boolean
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const target = W / H;

  if (letterbox) {
    // preserve the whole artwork, bars top/bottom or sides
    const s = Math.min(W / iw, H / ih) * (1 / cam.scale) * cam.scale;
    const dw = iw * s;
    const dh = ih * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return;
  }

  // intelligent crop: take the largest window matching the output
  // aspect, shrink it by the camera scale, centre it on the focal
  // point, then clamp so we never sample outside the artwork.
  let cropW = iw;
  let cropH = cropW / target;
  if (cropH > ih) {
    cropH = ih;
    cropW = cropH * target;
  }
  cropW /= cam.scale;
  cropH /= cam.scale;

  const fx = (cam.x + jitter.dx) * iw;
  const fy = (cam.y + jitter.dy) * ih;
  let sx = fx - cropW / 2;
  let sy = fy - cropH / 2;
  sx = Math.max(0, Math.min(iw - cropW, sx));
  sy = Math.max(0, Math.min(ih - cropH, sy));

  ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, W, H);
}

function applyTransition(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  kind: string,
  p: number,
  incoming = false
) {
  const k = Math.max(0, Math.min(1, p));
  switch (kind) {
    case "dip_to_black":
      ctx.fillStyle = `rgba(4,6,5,${k})`;
      ctx.fillRect(0, 0, W, H);
      break;
    case "flash":
      ctx.fillStyle = `rgba(255,252,240,${k * (incoming ? 0.55 : 0.75)})`;
      ctx.fillRect(0, 0, W, H);
      break;
    case "whip_pan": {
      ctx.fillStyle = `rgba(6,8,7,${k * 0.5})`;
      ctx.fillRect(0, 0, W, H);
      const bands = 14;
      ctx.fillStyle = `rgba(255,255,255,${k * 0.06})`;
      for (let i = 0; i < bands; i++) {
        const y = (i / bands) * H;
        ctx.fillRect(0, y, W, (H / bands) * 0.4);
      }
      break;
    }
    case "crossfade":
    default:
      ctx.fillStyle = `rgba(7,9,8,${k * 0.85})`;
      ctx.fillRect(0, 0, W, H);
      break;
  }
}

function drawSafeZones(ctx: CanvasRenderingContext2D, W: number, H: number, spec: AspectSpec) {
  const s = spec.safe;
  ctx.save();
  ctx.fillStyle = "rgba(255,90,90,0.10)";
  ctx.fillRect(0, 0, W, H * s.top);
  ctx.fillRect(0, H * (1 - s.bottom), W, H * s.bottom);
  ctx.fillRect(0, 0, W * s.left, H);
  ctx.fillRect(W * (1 - s.right), 0, W * s.right, H);
  ctx.strokeStyle = "rgba(108,180,238,0.5)";
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(W * s.left, H * s.top, W * (1 - s.left - s.right), H * (1 - s.top - s.bottom));
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(238,242,234,0.75)";
  ctx.font = '500 13px "JetBrains Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillText(`SAFE AREA · ${spec.platform}`, W * s.left + 8, H * s.top + 18);
  ctx.restore();
}

function bubbleProgress(el: TimelineElement, local: number) {
  const IN = 0.28;
  const OUT = 0.22;
  const inP = Math.min(1, (local - el.start) / IN);
  const outStart = el.end - OUT;
  const outP = local > outStart ? Math.min(1, (local - outStart) / OUT) : 0;
  return { inP: Math.max(0, inP), outP };
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  el: TimelineElement,
  local: number,
  W: number,
  H: number,
  spec: AspectSpec
) {
  const style = el.bubble_style ?? "speech";
  const skin = STYLE_SKIN[style] ?? STYLE_SKIN.speech;
  const { inP, outP } = bubbleProgress(el, local);

  // ---- entrance / exit animation ----
  let scale = 1;
  let alpha = 1;
  let dx = 0;
  let dy = 0;
  switch (el.anim_in) {
    case "pop_in":
      scale = 0.86 + 0.14 * easeOutBack(inP);
      alpha = Math.min(1, inP * 1.6);
      break;
    case "bounce_in":
      scale = 0.9 + 0.1 * easeOutBack(inP);
      dy = (1 - easeOutBack(inP)) * -18;
      alpha = Math.min(1, inP * 1.8);
      break;
    case "slide_in":
      dy = (1 - inP) * 26;
      alpha = inP;
      break;
    case "shake_in":
      alpha = Math.min(1, inP * 2);
      dx = inP < 1 ? Math.sin(inP * 34) * (1 - inP) * 9 : 0;
      scale = 0.94 + 0.06 * inP;
      break;
    case "fade_in":
    default:
      alpha = inP;
      break;
  }
  if (outP > 0) {
    if (el.anim_out === "pop_out") scale *= 1 - 0.12 * outP;
    alpha *= 1 - outP;
  }
  if (alpha <= 0.01) return;

  // ---- text layout ----
  const scaleRef = Math.min(W, H * (16 / 9)) / 960;
  const fontSize = Math.round((style === "narration" || style === "commentator" ? 21 : 24) * scaleRef);
  ctx.font = BUBBLE_FONT.replace("26px", `${fontSize}px`);
  const maxW = W * (style === "narration" || style === "crowd" || style === "commentator" ? 0.72 : 0.42);
  const lines = wrapText(ctx, el.text ?? "", maxW);
  const lineH = fontSize * 1.32;
  const padX = fontSize * 0.86;
  const padY = fontSize * 0.66;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), 40);
  const boxW = textW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;

  // ---- placement, clamped into the safe area ----
  const a = el.anchor ?? { x: 0.5, y: 0.25 };
  const s = spec.safe;
  let cx = a.x * W + dx;
  let cy = a.y * H + dy;
  cx = Math.max(W * s.left + boxW / 2, Math.min(W * (1 - s.right) - boxW / 2, cx));
  cy = Math.max(H * s.top + boxH / 2, Math.min(H * (1 - s.bottom) - boxH / 2, cy));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-boxW / 2, -boxH / 2);

  // drop shadow
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18 * scaleRef;
  ctx.shadowOffsetY = 6 * scaleRef;

  const r = style === "narration" || style === "commentator" ? 6 * scaleRef : 18 * scaleRef;
  ctx.fillStyle = skin.bg;
  ctx.strokeStyle = skin.stroke;
  ctx.lineWidth = Math.max(2, 2.6 * scaleRef);

  if (style === "shout") {
    spikyPath(ctx, boxW, boxH, 14 * scaleRef);
  } else if (style === "thought") {
    roundRectPath(ctx, 0, 0, boxW, boxH, r * 1.6);
  } else {
    roundRectPath(ctx, 0, 0, boxW, boxH, r);
  }
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (style === "whisper") {
    ctx.setLineDash([6 * scaleRef, 5 * scaleRef]);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // accent bar for banner styles
  if (style === "narration" || style === "commentator") {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(0, 0, 5 * scaleRef, boxH);
  }

  // tail for spoken styles
  if (style === "speech" || style === "shout" || style === "whisper") {
    ctx.beginPath();
    const tx = boxW * (a.x > 0.5 ? 0.68 : 0.32);
    ctx.moveTo(tx - 11 * scaleRef, boxH - 1);
    ctx.lineTo(tx + 9 * scaleRef, boxH - 1);
    ctx.lineTo(tx + (a.x > 0.5 ? 22 : -22) * scaleRef, boxH + 20 * scaleRef);
    ctx.closePath();
    ctx.fillStyle = skin.bg;
    ctx.fill();
    ctx.stroke();
  }

  // speaker chip
  if (el.speaker && (style === "speech" || style === "shout" || style === "commentator")) {
    ctx.font = `600 ${Math.round(fontSize * 0.5)}px "JetBrains Mono", monospace`;
    const label = el.speaker.toUpperCase();
    const lw = ctx.measureText(label).width + 14 * scaleRef;
    ctx.fillStyle = skin.accent;
    roundRectPath(ctx, padX * 0.4, -11 * scaleRef, lw, 18 * scaleRef, 5 * scaleRef);
    ctx.fill();
    ctx.fillStyle = "#0B0E0C";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padX * 0.4 + 7 * scaleRef, -2 * scaleRef);
  }

  // body text — rendered exactly as authored
  ctx.font = BUBBLE_FONT.replace("26px", `${fontSize}px`);
  ctx.fillStyle = skin.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  lines.forEach((ln, i) => {
    ctx.fillText(ln, padX, padY + i * lineH);
  });

  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function spikyPath(ctx: CanvasRenderingContext2D, w: number, h: number, spike: number) {
  const pts = 18;
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? 1 : 0.88;
    const x = w / 2 + Math.cos(a) * (w / 2 + (i % 2 === 0 ? spike * 0.35 : 0)) * rad;
    const y = h / 2 + Math.sin(a) * (h / 2 + (i % 2 === 0 ? spike * 0.5 : 0)) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function pickMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

