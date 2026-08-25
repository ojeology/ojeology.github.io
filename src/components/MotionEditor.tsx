import { useRef, useState } from "react";
import { AnimatePresence, motion as m } from "framer-motion";
import {
  AudioLines, Camera, Clapperboard, Download, Film, Gauge, Layers, Loader2,
  Mic, Pause, Play, RefreshCw, RotateCcw, ShieldCheck, Sparkles, SquarePlay,
  Volume2, VolumeX, Wand2, Zap,
} from "lucide-react";
import PreviewStage, { type StageHandle } from "./motion/PreviewStage";
import { motion as engineMotion, useMotion, linesForPanel } from "../engine/motion/runtime";
import { ASPECTS, SFX_LIBRARY, type AspectSpec, type CameraMove, type TTSProviderId } from "../engine/motion/types";
import { TTS_PROVIDERS, VOICE_PROFILES, voiceProfile } from "../engine/motion/tts";
import { sceneAt } from "../engine/motion/timeline";
import { Card, CardHeader, Chip, StatusBadge } from "./ui";

const CAMERA_MOVES: CameraMove[] = [
  "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down",
  "focus_character", "focus_center", "shake", "slow_drift",
];

const TRACKS = [
  { key: "camera", label: "CAMERA", color: "#A78BFA", icon: Camera },
  { key: "speech_bubble", label: "BUBBLES", color: "#6CB4EE", icon: SquarePlay },
  { key: "audio", label: "VOICE", color: "#3DD68C", icon: Mic },
  { key: "sfx", label: "SFX", color: "#E8C15A", icon: AudioLines },
  { key: "transition", label: "TRANS", color: "#FF6A3D", icon: Film },
] as const;

export default function MotionEditor() {
  const state = useMotion();
  const stage = useRef<StageHandle>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [letterbox, setLetterbox] = useState(false);
  const [muted, setMuted] = useState(false);
  const [building, setBuilding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const tl = state.project.timeline;
  const spec = ASPECTS[state.project.aspect_ratio];
  const current = tl ? sceneAt(tl, time) : null;
  const activeScene = current?.scene ?? tl?.scenes[0] ?? null;
  const selectedPanel = selected ?? activeScene?.panel_id ?? null;

  const runBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    setPlaying(false);
    setTime(0);
    try {
      await engineMotion.autoBuild();
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  const seekTo = (t: number) => {
    setPlaying(false);
    setTime(Math.max(0, Math.min(tl?.duration ?? 0, t)));
  };

  const renderVideo = async () => {
    if (!tl || !stage.current) return;
    const job = engineMotion.startRender("mp4");
    setPlaying(false);
    setTime(0);
    try {
      const out = await stage.current.record((pct, panel) => engineMotion.reportRenderProgress(job.id, pct, panel));
      engineMotion.completeRender(job.id, out.url, out.bytes);
    } catch (e) {
      engineMotion.failRender(job.id, "RENDER_FAILED", e instanceof Error ? e.message : String(e));
    }
  };

  const activeRender = state.renders[0];

  return (
    <div className="space-y-4">
      {/* ================= control bar ================= */}
      <Card>
        <div className="flex flex-wrap items-center gap-2.5 p-3">
          <button
            onClick={runBuild}
            disabled={building}
            className="flex items-center gap-2 rounded-lg bg-fairway px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {building ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} strokeWidth={2.5} />}
            {building ? `${state.buildPhase.replace("_", " ")}…` : tl ? "Re-run auto-build" : "Auto-build motion comic"}
          </button>

          <Select
            label="TTS"
            value={state.ttsProvider}
            onChange={(v) => engineMotion.setProvider(v as TTSProviderId)}
            options={(Object.keys(TTS_PROVIDERS) as TTSProviderId[]).map((id) => ({
              value: id,
              label: `${TTS_PROVIDERS[id].label}${TTS_PROVIDERS[id].capabilities.configured ? "" : " · no key"}`,
              disabled: !TTS_PROVIDERS[id].capabilities.configured,
            }))}
          />

          <Select
            label="Aspect"
            value={state.project.aspect_ratio}
            onChange={(v) => engineMotion.setAspect(v as AspectSpec["id"])}
            options={(Object.keys(ASPECTS) as AspectSpec["id"][]).map((id) => ({
              value: id,
              label: `${id} · ${ASPECTS[id].platform}`,
            }))}
          />

          <Toggle label="SFX" on={state.sfxEnabled} onClick={() => engineMotion.setSfx(!state.sfxEnabled)} />
          <Toggle label="Ambience" on={state.ambienceEnabled} onClick={() => engineMotion.setAmbience(!state.ambienceEnabled)} />
          <Toggle label="Safe zones" on={showSafe} onClick={() => setShowSafe((s) => !s)} />
          <Toggle label="Letterbox" on={letterbox} onClick={() => setLetterbox((s) => !s)} />

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Chip tone="border-fairway/30 bg-fairway/[0.07] text-fairway">{state.lines.length} lines</Chip>
            <Chip tone="border-city/30 bg-city/[0.07] text-city">{state.stats.synthesized} synthesized</Chip>
            <Chip tone="border-gold/30 bg-gold/[0.07] text-gold">{state.stats.cache_hits} cache hits</Chip>
            {tl && <Chip tone="border-violet/30 bg-violet/[0.07] text-violet">{tl.duration.toFixed(1)}s</Chip>}
          </div>
        </div>

        {(building || state.buildProgress > 0) && (
          <div className="border-t border-line px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.2em]">
              <span className="text-city">{state.buildPhase.replace(/_/g, " ")}</span>
              <span className="text-faint">{state.buildProgress}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <m.div className="h-full rounded-full bg-gradient-to-r from-city to-fairway" animate={{ width: `${state.buildProgress}%` }} transition={{ duration: 0.3 }} />
            </div>
          </div>
        )}
        {buildError && (
          <p className="border-t border-claret/20 bg-claret/[0.05] px-4 py-2 font-mono text-[10.5px] text-claret">{buildError}</p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ================= scenes ================= */}
        <div className="space-y-4 xl:col-span-3">
          <Card>
            <CardHeader title="Scenes" mono={`${tl?.scenes.length ?? 0} imported`} />
            <div className="max-h-[300px] divide-y divide-white/[0.04] overflow-y-auto code-scroll">
              {(tl?.scenes ?? []).map((s) => {
                const active = activeScene?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelected(s.panel_id);
                      seekTo(s.offset + 0.05);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${active ? "bg-city/[0.07]" : "hover:bg-white/[0.02]"}`}
                  >
                    {s.image_url ? (
                      <img src={s.image_url} alt="" className="h-9 w-14 shrink-0 rounded border border-white/10 object-cover" />
                    ) : (
                      <span className="h-9 w-14 shrink-0 rounded border border-white/10 bg-black/40" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12px] font-semibold ${active ? "text-bone" : "text-bone/75"}`}>
                        P{String(s.panel_number).padStart(2, "0")} {s.title}
                      </span>
                      <span className="font-mono text-[9px] text-faint">
                        {s.duration.toFixed(1)}s · {s.elements.find((e) => e.type === "camera")?.camera?.move ?? "—"} · {s.transition_out}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!tl && <p className="px-3 py-6 text-center font-mono text-[10px] text-faint">run auto-build to import panels</p>}
            </div>
          </Card>

          {activeScene && (
            <Card>
              <CardHeader title="Scene controls" mono={activeScene.panel_id} />
              <div className="space-y-3 p-3">
                <div>
                  <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">camera move — no re-render of art or voice</p>
                  <div className="flex flex-wrap gap-1">
                    {CAMERA_MOVES.map((mv) => {
                      const on = activeScene.elements.find((e) => e.type === "camera")?.camera?.move === mv;
                      return (
                        <button
                          key={mv}
                          onClick={() => engineMotion.updateCamera(activeScene.id, mv)}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${on ? "border-violet/50 bg-violet/[0.12] text-violet" : "border-white/10 text-dim hover:text-bone"}`}
                        >
                          {mv}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {activeScene.warnings.map((w) => (
                  <p key={w} className="rounded border border-gold/20 bg-gold/[0.05] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-gold/85">{w}</p>
                ))}
                <button
                  onClick={() => engineMotion.regenerateScene(activeScene.panel_id)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-dim transition-colors hover:border-ember/40 hover:text-ember"
                >
                  <RefreshCw size={11} /> regenerate whole scene
                </button>
              </div>
            </Card>
          )}
        </div>

        {/* ================= preview ================= */}
        <div className="space-y-4 xl:col-span-6">
          <Card className="overflow-hidden">
            <CardHeader
              title="Preview"
              mono={`${spec.width}×${spec.height} · ${state.project.fps}fps`}
              right={
                activeScene ? (
                  <span className="font-mono text-[9.5px] text-faint">
                    P{String(activeScene.panel_number).padStart(2, "0")} · {activeScene.event_type ?? "scene"}
                  </span>
                ) : undefined
              }
            />
            <div className="flex items-center justify-center bg-black/60 p-3">
              <div
                className="relative w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black"
                style={{ maxWidth: spec.id === "9:16" ? 300 : spec.id === "1:1" ? 460 : "100%", aspectRatio: spec.id.replace(":", " / ") }}
              >
                <PreviewStage
                  ref={stage}
                  timeline={tl}
                  aspect={state.project.aspect_ratio}
                  time={time}
                  playing={playing}
                  showSafe={showSafe}
                  letterbox={letterbox}
                  muted={muted}
                  onTime={setTime}
                  onEnded={() => setPlaying(false)}
                />
                {!tl && (
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <Clapperboard className="mx-auto mb-2 h-7 w-7 text-faint/60" />
                      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">no timeline yet</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* transport */}
            <div className="flex items-center gap-2.5 border-t border-line px-3 py-2.5">
              <button
                onClick={() => setPlaying((p) => !p)}
                disabled={!tl}
                className="grid h-9 w-9 place-items-center rounded-full bg-fairway text-ink transition-transform hover:brightness-110 active:scale-95 disabled:opacity-40"
              >
                {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
              </button>
              <button onClick={() => seekTo(0)} disabled={!tl} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-dim hover:text-bone disabled:opacity-40">
                <RotateCcw size={13} />
              </button>
              <button onClick={() => setMuted((v) => !v)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-dim hover:text-bone">
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <input
                type="range"
                min={0}
                max={tl?.duration ?? 1}
                step={0.02}
                value={time}
                onChange={(e) => seekTo(+e.target.value)}
                disabled={!tl}
                className="brush flex-1"
                style={{ ["--fill" as string]: `${tl ? (time / tl.duration) * 100 : 0}%` }}
              />
              <span className="font-mono text-[10.5px] tabular-nums text-dim">
                {fmt(time)} / {fmt(tl?.duration ?? 0)}
              </span>
            </div>
          </Card>

          {/* ================= timeline tracks ================= */}
          <Card>
            <CardHeader
              title="Timeline"
              mono={tl ? `${tl.scenes.reduce((a, s) => a + s.elements.length, 0)} elements · GET /timeline` : "empty"}
            />
            <div className="p-3">
              {tl ? (
                <div className="space-y-1.5">
                  {/* scene ruler */}
                  <div className="relative h-5 w-full overflow-hidden rounded bg-white/[0.03]">
                    {tl.scenes.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => seekTo(s.offset + 0.05)}
                        className="absolute top-0 h-full border-r border-ink/60 text-left transition-colors hover:bg-white/[0.06]"
                        style={{ left: `${(s.offset / tl.duration) * 100}%`, width: `${(s.duration / tl.duration) * 100}%`, background: i % 2 ? "rgba(108,180,238,0.09)" : "rgba(61,214,140,0.09)" }}
                      >
                        <span className="pl-1.5 font-mono text-[8.5px] leading-5 text-bone/70">P{String(s.panel_number).padStart(2, "0")}</span>
                      </button>
                    ))}
                    <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-ember" style={{ left: `${(time / tl.duration) * 100}%` }} />
                  </div>

                  {TRACKS.map((track) => {
                    const Icon = track.icon;
                    return (
                      <div key={track.key} className="flex items-center gap-2">
                        <span className="flex w-[70px] shrink-0 items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.15em] text-faint">
                          <Icon size={10} style={{ color: track.color }} /> {track.label}
                        </span>
                        <div className="relative h-6 flex-1 overflow-hidden rounded bg-white/[0.025]">
                          {tl.scenes.flatMap((s) =>
                            s.elements
                              .filter((e) => e.type === track.key)
                              .map((e) => {
                                const left = ((s.offset + e.start) / tl.duration) * 100;
                                const width = Math.max(0.35, ((e.end - e.start) / tl.duration) * 100);
                                const label = e.type === "speech_bubble" ? e.speaker : e.type === "sfx" ? SFX_LIBRARY[e.sfx!]?.label : e.type === "camera" ? e.camera?.move : e.type === "transition" ? e.transition : e.speaker;
                                return (
                                  <button
                                    key={`${s.id}-${e.id}`}
                                    onClick={() => seekTo(s.offset + e.start)}
                                    title={`${label} · ${e.start.toFixed(2)}–${e.end.toFixed(2)}s`}
                                    className="absolute top-[3px] h-[18px] overflow-hidden rounded-[3px] border text-left transition-transform hover:scale-y-110"
                                    style={{
                                      left: `${left}%`,
                                      width: `${width}%`,
                                      background: `${track.color}22`,
                                      borderColor: `${track.color}66`,
                                    }}
                                  >
                                    <span className="block truncate px-1 font-mono text-[8px] leading-[18px]" style={{ color: track.color }}>
                                      {label}
                                    </span>
                                  </button>
                                );
                              })
                          )}
                          <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-ember/80" style={{ left: `${(time / tl.duration) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center font-mono text-[10px] text-faint">
                  auto-build generates every track automatically — you never type a timecode
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ================= right column ================= */}
        <div className="space-y-4 xl:col-span-3">
          {/* export */}
          <Card>
            <CardHeader title="Render & Export" mono="POST /render" right={<Gauge size={13} className="text-faint" />} />
            <div className="space-y-2.5 p-3">
              <button
                onClick={renderVideo}
                disabled={!tl || activeRender?.status === "rendering"}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-city px-3 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-ink transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                {activeRender?.status === "rendering" ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} strokeWidth={2.5} />}
                {activeRender?.status === "rendering" ? "rendering…" : "Render video"}
              </button>
              <p className="font-mono text-[9px] leading-relaxed text-faint">
                Captures the live canvas + the synthesized SFX bus into a real video file. Browser speech
                cannot be routed into MediaRecorder, so <span className="text-gold/80">voice is preview-only here</span> —
                server-side, FFmpeg muxes the TTS audio files into the H.264 MP4.
              </p>

              {state.renders.map((r) => (
                <div key={r.id} className="rounded-lg border border-white/[0.07] bg-black/25 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-bone/85">{r.id}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.status === "rendering" && (
                    <>
                      <div className="mb-1 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full bg-city transition-all" style={{ width: `${r.progress}%` }} />
                      </div>
                      <p className="font-mono text-[9px] text-faint">
                        {r.progress}% · panel {r.current_panel}/{r.total_panels}
                      </p>
                    </>
                  )}
                  {r.status === "completed" && r.video_url && (
                    <div className="space-y-2">
                      <video src={r.video_url} controls className="w-full rounded border border-white/10" />
                      <a
                        href={r.video_url}
                        download={`bryme-motion-${r.aspect.replace(":", "x")}.${r.video_url.includes("mp4") ? "mp4" : "webm"}`}
                        className="flex items-center justify-center gap-1.5 rounded border border-fairway/40 bg-fairway/[0.08] px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.15em] text-fairway"
                      >
                        <Download size={11} /> download · {((r.size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB
                      </a>
                    </div>
                  )}
                  {r.error && <p className="font-mono text-[9px] text-claret">{r.error.code}: {r.error.message}</p>}
                </div>
              ))}
            </div>
          </Card>

          {/* dialogue + voices */}
          <Card>
            <CardHeader title="Dialogue & Voice" mono={selectedPanel ?? "—"} right={<Mic size={13} className="text-faint" />} />
            <div className="max-h-[340px] divide-y divide-white/[0.04] overflow-y-auto code-scroll">
              {selectedPanel &&
                linesForPanel(state, selectedPanel).map((line) => {
                  const vp = voiceProfile(line.voice_profile_id);
                  const asset = state.assets[line.id];
                  return (
                    <div key={line.id} className="p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.15em] text-city">{line.speaker_label}</span>
                        <Chip tone="border-white/10 bg-white/[0.03] text-faint">{line.bubble_style}</Chip>
                      </div>
                      <p className="mb-2 rounded border border-white/[0.06] bg-black/30 px-2 py-1.5 text-[12px] leading-relaxed text-bone/85">
                        “{line.text}”
                      </p>
                      <div className="mb-2 flex flex-wrap gap-1">
                        <Chip tone="border-gold/25 bg-gold/[0.06] text-gold/90">{line.language_label}</Chip>
                        <Chip tone="border-violet/25 bg-violet/[0.06] text-violet/90">{line.emotion}</Chip>
                        {asset && (
                          <Chip tone={asset.duration_source === "measured" ? "border-fairway/30 bg-fairway/[0.07] text-fairway" : "border-white/10 bg-white/[0.03] text-dim"}>
                            {asset.duration.toFixed(2)}s {asset.duration_source}
                          </Chip>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={line.voice_profile_id}
                          onChange={(e) => engineMotion.regenerateVoice(line.id, { voice_profile_id: e.target.value })}
                          className="min-w-0 flex-1 truncate rounded border border-white/10 bg-ink px-1.5 py-1 font-mono text-[9px] text-dim outline-none focus:border-city/50"
                        >
                          {VOICE_PROFILES.map((v) => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => engineMotion.regenerateVoice(line.id)}
                          title="Regenerate voice only — artwork untouched"
                          className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-dim transition-colors hover:border-fairway/50 hover:text-fairway"
                        >
                          <RefreshCw size={10} />
                        </button>
                      </div>
                      <p className="mt-1 font-mono text-[8.5px] text-faint">{vp.accent} · {vp.language} · speed {(line.speed_override ?? vp.speed).toFixed(2)}</p>
                    </div>
                  );
                })}
              {!selectedPanel && <p className="px-3 py-6 text-center font-mono text-[10px] text-faint">select a scene</p>}
            </div>
          </Card>

          {/* build log */}
          <Card>
            <CardHeader title="Build log" mono={`${state.log.length} entries`} right={<Sparkles size={13} className="text-faint" />} />
            <div className="max-h-[200px] space-y-0.5 overflow-y-auto code-scroll p-3">
              <AnimatePresence initial={false}>
                {state.log.slice(-40).map((l, i) => (
                  <m.p
                    key={`${l.t}-${i}`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`font-mono text-[9px] leading-relaxed ${
                      l.tone === "ok" ? "text-fairway/90" : l.tone === "warn" ? "text-gold/85" : l.tone === "err" ? "text-claret" : "text-dim"
                    }`}
                  >
                    <span className="text-faint/60">{l.t}</span> [{l.phase}] {l.msg}
                  </m.p>
                ))}
              </AnimatePresence>
              {state.log.length === 0 && <p className="py-4 text-center font-mono text-[10px] text-faint">idle</p>}
            </div>
          </Card>

          <Card className="border-city/20 bg-city/[0.03]">
            <div className="flex items-start gap-2.5 p-3">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-city" />
              <p className="font-mono text-[9px] leading-relaxed text-bone/70">
                No mainstream TTS API exposes a native Nigerian-Pidgin locale. Pidgin text is passed through
                <span className="text-city"> verbatim</span> and voiced by the closest Nigerian-English profile —
                never translated, never rewritten. All SFX are synthesized from primitives (no broadcast audio).
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- atoms ---- */

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-mono text-[10.5px] text-bone outline-none [&>option]:bg-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.15em] transition-colors ${
        on ? "border-fairway/40 bg-fairway/[0.08] text-fairway" : "border-white/10 bg-white/[0.02] text-dim hover:text-bone"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-fairway" : "bg-faint/50"}`} />
      {label}
    </button>
  );
}

function fmt(t: number) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(Math.floor((t % 1) * 10))}`;
}

/* re-export for the nav badge */
export function useMotionDuration() {
  const s = useMotion();
  return s.project.timeline?.duration ?? 0;
}
export { Layers };

