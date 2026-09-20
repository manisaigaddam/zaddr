"use client";

let ctx: AudioContext | null = null;
let muted = false;
let musicTimer: number | null = null;
let musicStep = 0;
let musicTrack = 0;

const tracks = [
  [196, 247, 294, 247, 220, 247, 294, 330],
  [165, 196, 247, 294, 247, 196, 220, 247],
  [147, 196, 220, 247, 294, 247, 220, 196],
];

function audio() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(v: boolean) {
  muted = v;
  if (muted) stopMusic();
  try {
    localStorage.setItem("zaddr.sfx", v ? "0" : "1");
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem("zaddr.sfx") === "0";
  } catch {
    return false;
  }
}

type SoundKind = "ui" | "place" | "cpu" | "win" | "lose" | "draw" | "join" | "timeout";

function beep(
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  gain = 0.05,
  delay = 0,
) {
  if (muted) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function tone(freq: number, dur: number, gain = 0.018, delay = 0) {
  beep(freq, dur, "triangle", gain, delay);
}

function musicTick() {
  if (muted) return;
  const seq = tracks[musicTrack % tracks.length];
  const n = seq[musicStep % seq.length];
  tone(n, 0.22, 0.012);
  if (musicStep % 2 === 0) tone(n / 2, 0.38, 0.01, 0.01);
  if (musicStep % 16 === 15) musicTrack += 1;
  musicStep += 1;
}

export function startMusic(): void {
  if (musicTimer != null || muted) return;
  audio();
  musicTick();
  musicTimer = window.setInterval(musicTick, 420);
}

export function stopMusic(): void {
  if (musicTimer == null) return;
  window.clearInterval(musicTimer);
  musicTimer = null;
}

export function musicPlaying(): boolean {
  return musicTimer != null;
}

export function sfx(kind: SoundKind) {
  if (muted) return;
  switch (kind) {
    case "ui":
      beep(660, 0.045, "square", 0.018);
      break;
    case "place":
      beep(220, 0.055, "square", 0.032);
      beep(330, 0.07, "square", 0.026, 0.045);
      break;
    case "cpu":
      beep(147, 0.07, "square", 0.026);
      break;
    case "win":
      beep(523, 0.1, "square", 0.06);
      beep(659, 0.12, "square", 0.06, 0.1);
      beep(784, 0.18, "square", 0.07, 0.22);
      break;
    case "lose":
      beep(196, 0.16, "sawtooth", 0.05);
      beep(130, 0.22, "sawtooth", 0.05, 0.12);
      break;
    case "draw":
      beep(330, 0.12, "triangle", 0.05);
      beep(247, 0.16, "triangle", 0.05, 0.1);
      break;
    case "join":
      beep(392, 0.08, "square", 0.04);
      beep(523, 0.1, "square", 0.04, 0.08);
      break;
    case "timeout":
      beep(110, 0.28, "square", 0.06);
      break;
    default:
      break;
  }
}

export function bootSfx(): void {
  muted = isMuted();
  audio();
}
