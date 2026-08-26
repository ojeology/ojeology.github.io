/* ============================================================
   BRYME MOTION — audio bus
   Voice (Web Speech) + SFX (synthesized) + music, mixed through a
   Web Audio graph. Every effect is generated from primitives, so
   nothing here is sampled from broadcast or copyrighted material.
   Server-side the same graph is expressed as an FFmpeg amix chain.
   ============================================================ */

import { SFX_LIBRARY, type SfxId } from "./types";
import { DEFAULT_PIDGIN_LANG, isPidginDefaultVoice, pickBrowserVoice, pickPidginVoice, voiceProfile } from "./tts";
import type { DialogueLine } from "./types";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let voiceBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let recorderTap: MediaStreamAudioDestinationNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

export interface MixSettings {
  voice_gain: number;
  sfx_gain: number;
  music_gain: number;
  music_enabled: boolean;
  duck_sfx_under_voice: boolean;
}

export function audioReady(): boolean {
  return ctx !== null && ctx.state === "running";
}

export async function initAudio(): Promise<AudioContext> {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;

    voiceBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    voiceBus.gain.value = 1;
    sfxBus.gain.value = 0.85;
    musicBus.gain.value = 0;

    voiceBus.connect(master);
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(ctx.destination);

    recorderTap = ctx.createMediaStreamDestination();
    master.connect(recorderTap);

    // shared pink-ish noise bed for crowd textures
    const len = ctx.sampleRate * 3;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099;
      b1 = 0.963 * b1 + white * 0.2965;
      b2 = 0.57 * b2 + white * 1.0526;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
  }
  if (ctx.state === "suspended") await ctx.resume();
  return ctx;
}

export function applyMix(m: MixSettings) {
  if (!voiceBus || !sfxBus || !musicBus) return;
  voiceBus.gain.value = m.voice_gain;
  sfxBus.gain.value = m.sfx_gain;
  musicBus.gain.value = m.music_enabled ? m.music_gain : 0;
}

/** Stream tap so MediaRecorder can capture the mixed soundtrack. */
export function audioStream(): MediaStream | null {
  return recorderTap?.stream ?? null;
}

/** Momentary duck so effects never fight the voiceover. */
export function duck(depth = 0.45, ms = 260) {
  if (!ctx || !sfxBus) return;
  const now = ctx.currentTime;
  const target = sfxBus.gain.value * depth;
  sfxBus.gain.cancelScheduledValues(now);
  sfxBus.gain.setTargetAtTime(target, now, 0.08);
  sfxBus.gain.setTargetAtTime(sfxBus.gain.value, now + ms / 1000, 0.25);
}

/* ------------------------------------------------ sfx synth ---- */

export function playSfx(id: SfxId, gainScale = 1) {
  if (!ctx || !sfxBus || !noiseBuffer) return;
  const spec = SFX_LIBRARY[id];
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = spec.gain * gainScale;
  out.connect(sfxBus);

  switch (spec.synth) {
    case "noise_swell": {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 780;
      bp.Q.value = 0.7;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(1, t0 + spec.duration * 0.22);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
      bp.frequency.setValueAtTime(520, t0);
      bp.frequency.linearRampToValueAtTime(1150, t0 + spec.duration * 0.35);
      src.connect(bp).connect(env).connect(out);
      src.start(t0);
      src.stop(t0 + spec.duration + 0.05);
      break;
    }
    case "noise_burst": {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1800;
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
      src.connect(hp).connect(env).connect(out);
      src.start(t0);
      src.stop(t0 + spec.duration + 0.05);
      break;
    }
    case "whistle": {
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = "sine";
      o2.type = "sine";
      o1.frequency.setValueAtTime(2350, t0);
      o2.frequency.setValueAtTime(2960, t0);
      // trill
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 22;
      lfoGain.gain.value = 60;
      lfo.connect(lfoGain);
      lfoGain.connect(o1.frequency);
      lfoGain.connect(o2.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.9, t0 + 0.04);
      env.gain.setValueAtTime(0.9, t0 + spec.duration - 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
      o1.connect(env);
      o2.connect(env);
      env.connect(out);
      lfo.start(t0);
      o1.start(t0);
      o2.start(t0);
      lfo.stop(t0 + spec.duration);
      o1.stop(t0 + spec.duration);
      o2.stop(t0 + spec.duration);
      break;
    }
    case "impact": {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(170, t0);
      osc.frequency.exponentialRampToValueAtTime(42, t0 + spec.duration);
      const env = ctx.createGain();
      env.gain.setValueAtTime(1, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
      osc.connect(env).connect(out);
      osc.start(t0);
      osc.stop(t0 + spec.duration + 0.02);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2200;
      const nEnv = ctx.createGain();
      nEnv.gain.setValueAtTime(0.7, t0);
      nEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      src.connect(bp).connect(nEnv).connect(out);
      src.start(t0);
      src.stop(t0 + 0.2);
      break;
    }
    case "sweep": {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, t0);
      bp.frequency.exponentialRampToValueAtTime(4200, t0 + spec.duration);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(1, t0 + spec.duration * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.duration);
      src.connect(bp).connect(env).connect(out);
      src.start(t0);
      src.stop(t0 + spec.duration + 0.05);
      break;
    }
    case "chatter": {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 0.5;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 3.1;
      lfoGain.gain.value = 0.25;
      const env = ctx.createGain();
      env.gain.value = 0.55;
      lfo.connect(lfoGain).connect(env.gain);
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0.0001, t0);
      fade.gain.linearRampToValueAtTime(1, t0 + 0.5);
      fade.gain.setValueAtTime(1, t0 + Math.max(0.6, spec.duration - 0.5));
      fade.gain.linearRampToValueAtTime(0.0001, t0 + spec.duration);
      src.connect(bp).connect(env).connect(fade).connect(out);
      lfo.start(t0);
      src.start(t0);
      lfo.stop(t0 + spec.duration);
      src.stop(t0 + spec.duration + 0.05);
      break;
    }
  }
}

/* ---------------------------------------------- voice output ---- */

let activeUtterance: SpeechSynthesisUtterance | null = null;

export interface SpokenResult {
  measured: number;
  cancelled: boolean;
}

/**
 * Speak a line through the Web Speech API and measure how long it
 * actually took. That measurement is fed back into the timeline so
 * bubbles re-sync to real delivery instead of the estimate.
 */
export interface SpeakVoice {
  voiceName?: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  gender?: "male" | "female" | "neutral";
}

function resolveUtteranceVoice(voice: SpeakVoice): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const gender = voice.gender === "female" ? "female" : "male";
  const named = voice.voiceName ? voices.find((v) => v.name === voice.voiceName) : undefined;
  if (named && isPidginDefaultVoice(named, gender)) return named;
  return pickPidginVoice(voices, gender) ?? named;
}

function speakNow(text: string, voice: SpeakVoice, onEnd?: (r: SpokenResult) => void): void {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const picked = resolveUtteranceVoice(voice);
  if (picked) u.voice = picked;
  u.lang = picked?.lang ?? voice.lang ?? DEFAULT_PIDGIN_LANG;
  u.rate = clampRate(voice.rate ?? 1);
  u.pitch = Math.max(0, Math.min(2, voice.pitch ?? 1));
  u.volume = voice.volume ?? 1;

  const t0 = performance.now();
  u.onend = () => {
    activeUtterance = null;
    onEnd?.({ measured: (performance.now() - t0) / 1000, cancelled: false });
  };
  u.onerror = () => {
    activeUtterance = null;
    onEnd?.({ measured: (performance.now() - t0) / 1000, cancelled: true });
  };
  activeUtterance = u;
  window.speechSynthesis.speak(u);
}

export function speakText(text: string, voice: SpeakVoice = {}, onEnd?: (r: SpokenResult) => void): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.({ measured: 0, cancelled: true });
    return;
  }
  if (window.speechSynthesis.getVoices().length) {
    speakNow(text, voice, onEnd);
    return;
  }
  let kicked = false;
  const kick = () => {
    if (kicked) return;
    kicked = true;
    window.speechSynthesis.removeEventListener("voiceschanged", kick);
    speakNow(text, voice, onEnd);
  };
  window.speechSynthesis.addEventListener("voiceschanged", kick);
  window.setTimeout(kick, 400);
}

export function speakLine(line: DialogueLine, onEnd?: (r: SpokenResult) => void, extra?: SpeakVoice): void {
  const profile = voiceProfile(line.voice_profile_id);
  const picked = extra?.voiceName ? undefined : pickBrowserVoice(profile);
  speakText(
    line.text,
    {
      voiceName: extra?.voiceName ?? picked?.name,
      lang: extra?.lang ?? picked?.lang ?? DEFAULT_PIDGIN_LANG,
      rate: extra?.rate ?? line.speed_override ?? profile.speed,
      pitch: extra?.pitch ?? line.pitch_override ?? profile.pitch,
      volume: extra?.volume ?? profile.volume,
      gender: extra?.gender ?? (profile.gender === "female" ? "female" : "male"),
    },
    onEnd
  );
}

function clampRate(r: number) {
  return Math.max(0.1, Math.min(10, r));
}

export function stopSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  activeUtterance = null;
}

export function isSpeaking(): boolean {
  return activeUtterance !== null;
}

