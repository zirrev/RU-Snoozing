import { useEffect, useRef, useState } from "react";

/**
 * Determine "idle" from facial motion.
 * Idle = EAR and pitch don't change beyond thresholds for `idleMs`.
 */
export type FaceActivityOpts = {
  idleMs?: number;     // how long without meaningful change => idle (default 10s)
  earDelta?: number;   // minimum EAR change to count as movement
  pitchDelta?: number; // minimum pitch change (degrees) to count as movement
  pollMs?: number;     // how often to check for changes
};

export function useFaceActivity(
  ear: number,
  pitchDeg: number,
  opts: FaceActivityOpts = {}
) {
  const {
    idleMs = 10000,
    earDelta = 0.02,
    pitchDelta = 1.5,
    pollMs = 400,
  } = opts;

  const [idle, setIdle] = useState(false);
  const [lastChangeAt, setLastChangeAt] = useState<number>(Date.now());

  const prevEarRef = useRef<number>(ear);
  const prevPitchRef = useRef<number>(pitchDeg);

  // Watch for meaningful change in EAR/pitch and mark active
  useEffect(() => {
    const prevEar = prevEarRef.current;
    const prevPitch = prevPitchRef.current;

    const earChanged = Math.abs(ear - prevEar) >= earDelta;
    const pitchChanged = Math.abs(pitchDeg - prevPitch) >= pitchDelta;

    if (earChanged || pitchChanged) {
      setLastChangeAt(Date.now());
      if (idle) setIdle(false);
    }

    prevEarRef.current = ear;
    prevPitchRef.current = pitchDeg;
  }, [ear, pitchDeg, earDelta, pitchDelta, idle]);

  // Periodically check if we've been still long enough to be idle
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setIdle(now - lastChangeAt >= idleMs);
    }, pollMs);

    return () => window.clearInterval(interval);
  }, [lastChangeAt, idleMs, pollMs]);

  const secondsSinceChange = Math.max(
    0,
    Math.round((Date.now() - lastChangeAt) / 1000)
  );

  return { idle, lastChangeAt, secondsSinceChange };
}