// src/beep.ts
let AC: AudioContext | null = null;

function ctx() {
  const C = (window.AudioContext || (window as any).webkitAudioContext);
  if (!AC || AC.state === "closed") AC = new C();
  if (AC.state === "suspended") AC.resume();
  return AC;
}

export function beep(duration = 80, freq = 180) {
  // Play 3 short beeps, each of `duration` ms, spaced 120ms apart
  const a = ctx();
  const beepCount = 3;
  const beepDuration = duration / 1000; // in seconds
  const interval = 0.12; // 120ms between beeps
  const t0 = a.currentTime;
  for (let i = 0; i < beepCount; ++i) {
    const t = t0 + i * interval;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(a.destination);
    // Envelope
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    osc.start(t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + beepDuration);
    osc.stop(t + beepDuration + 0.02);
  }
}