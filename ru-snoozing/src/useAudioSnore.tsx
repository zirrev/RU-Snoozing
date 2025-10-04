import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simple amplitude-based snore/noise detector using Web Audio API.
 * Fires `onSnore()` when RMS stays above `threshold` for `holdMs`.
 */
export function useAudioSnore(opts: {
  threshold?: number;   // 0..1 RMS (try 0.08–0.20)
  holdMs?: number;      // milliseconds above threshold to count as snore
  onSnore?: () => void; // callback when detected
} = {}) {
  const { threshold = 0.12, holdMs = 300, onSnore } = opts;

  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rms, setRms] = useState(0);

  const acRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const aboveSinceRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    analyserRef.current = null;
    srcRef.current?.disconnect();
    srcRef.current = null;

    if (acRef.current) {
      acRef.current.close();
      acRef.current = null;
    }
    setMicReady(false);
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ac = new AC();
      acRef.current = ac;

      const src = ac.createMediaStreamSource(stream);
      srcRef.current = src;

      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;

      src.connect(analyser);
      setMicReady(true);

      const loop = () => {
        const a = analyserRef.current;
        if (!a) return;
        const buf = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(buf);

        // RMS 0..1
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128; // -1..1
          sum += v * v;
        }
        const level = Math.sqrt(sum / buf.length);
        setRms(level);

        const now = performance.now();
        if (level >= threshold) {
          if (aboveSinceRef.current == null) aboveSinceRef.current = now;
          if (now - (aboveSinceRef.current ?? now) >= holdMs) {
            aboveSinceRef.current = null;
            onSnore?.();
          }
        } else {
          aboveSinceRef.current = null;
        }

        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e: any) {
      setError(e?.message || "Microphone error");
      stop();
    }
  }, [holdMs, onSnore, stop, threshold]);

  useEffect(() => stop, [stop]);

  return { micReady, error, rms, start, stop };
}

/** Simple beep using Web Audio API */
export function beep(duration = 600, freq = 880) {
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ac = new AC();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = "square";
  o.frequency.value = freq;
  o.connect(g);
  g.connect(ac.destination);
  g.gain.value = 0.0001;
  const t = ac.currentTime;
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  o.start();
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration / 1000);
  o.stop(t + duration / 1000 + 0.02);
}