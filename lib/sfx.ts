"use client";

let ctx: AudioContext | null = null;
let muted = false;

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

export function setMuted(v) {
  muted = v;
  try {
    localStorage.setItem("zaddr.sfx", v ? "0" : "1");
  } catch {
    /* ignore */
  }
}

export function isMuted() {
  try {
    return localStorage.getItem("zaddr.sfx") === "0";
  } catch {
    return false;
  }
}

function beep(freq, dur, type = "square", gain = 0.05, delay = 0) {
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

export function sfx(kind) {
  if (muted) return;
  switch (kind) {
    case "ui":
      beep(880, 0.05, "square", 0.03);
      break;
    case "place":
      beep(196, 0.07, "square", 0.06);
      beep(330, 0.08, "square", 0.04, 0.05);
      break;
    case "cpu":
      beep(146, 0.08, "square", 0.05);
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

export function bootSfx() {
  muted = isMuted();
  audio();
}
