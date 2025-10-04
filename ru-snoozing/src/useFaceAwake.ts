// src/useFaceAwake.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

type MPFilesetResolver = any;
type MPFaceLandmarker = any;

type FaceAwakeOpts = {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  earThreshold?: number; // lower = more sensitive (eyes "closed")
  dwellMs?: number;      // how long EAR must stay below threshold to trigger
  onDrowsy?: () => void; // called once per dwell event
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useFaceAwake({
  videoRef,
  earThreshold = 0.18,
  dwellMs = 600,
  onDrowsy,
}: FaceAwakeOpts) {
  const [ready, setReady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [ear, setEAR] = useState(0);
  const [drowsy, setDrowsy] = useState(false);

  const rafRef = useRef<number | null>(null);
  const filesetRef = useRef<any>(null);
  const landmarkerRef = useRef<any>(null);
  const belowSinceRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<number>(0);

  // --- load model once
  const load = useCallback(async () => {
    if (landmarkerRef.current) return;
    const mod = await import("@mediapipe/tasks-vision");
    const { FilesetResolver, FaceLandmarker } = mod as {
      FilesetResolver: MPFilesetResolver;
      FaceLandmarker: MPFaceLandmarker;
    };

    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );
    filesetRef.current = fileset;

    landmarkerRef.current = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: "VIDEO",
      numFaces: 1,
    });

    setReady(true);
  }, []);

  // --- math helpers
  const dist = (a: any, b: any) => {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.hypot(dx, dy);
  };

  // EAR using MediaPipe FaceMesh indices
  // Left eye: horizontals (33,133), verticals (159,145) & (158,153)
  // Right eye: horizontals (263,362), verticals (386,374) & (385,380)
  const computeEAR = (lm: any[]) => {
    const L = {
      H1: lm[33],  H2: lm[133],
      V1a: lm[159], V1b: lm[145],
      V2a: lm[158], V2b: lm[153],
    };
    const R = {
      H1: lm[263], H2: lm[362],
      V1a: lm[386], V1b: lm[374],
      V2a: lm[385], V2b: lm[380],
    };
    const leftH = dist(L.H1, L.H2);
    const leftV = (dist(L.V1a, L.V1b) + dist(L.V2a, L.V2b)) / 2;
    const rightH = dist(R.H1, R.H2);
    const rightV = (dist(R.V1a, R.V1b) + dist(R.V2a, R.V2b)) / 2;

    const leftEAR = leftV / (leftH + 1e-6);
    const rightEAR = rightV / (rightH + 1e-6);
    return (leftEAR + rightEAR) / 2;
  };

  // --- loop
  const analyze = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    const nowMs = performance.now();
    const res = landmarker.detectForVideo(video, nowMs);
    const face = res?.faceLandmarks?.[0];

    if (face) {
      const curEAR = computeEAR(face);
      // simple smoothing
      setEAR((prev) => prev * 0.6 + curEAR * 0.4);

      const earBelow = curEAR < earThreshold;
      if (earBelow) {
        if (belowSinceRef.current == null) belowSinceRef.current = nowMs;
        if (nowMs - (belowSinceRef.current ?? nowMs) >= dwellMs) {
          // fire once per sustained close
          if (nowMs - lastTriggerRef.current > dwellMs) {
            setDrowsy(true);
            lastTriggerRef.current = nowMs;
            onDrowsy?.();
          }
        }
      } else {
        belowSinceRef.current = null;
        setDrowsy(false);
      }
    } else {
      setDrowsy(false);
    }

    rafRef.current = requestAnimationFrame(analyze);
  }, [videoRef, earThreshold, dwellMs, onDrowsy]);

  // --- public controls
  const start = useCallback(async () => {
    await load();
    // ensure video is ready before analyzing
    const video = videoRef.current;
    if (!video) return;
    const waitReady = () =>
      new Promise<void>((resolve) => {
        if (video.readyState >= 2) return resolve();
        video.onloadeddata = () => resolve();
      });
    await waitReady();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setAnalyzing(true);
    rafRef.current = requestAnimationFrame(analyze);
  }, [analyze, load, videoRef]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setAnalyzing(false);
    setDrowsy(false);
    belowSinceRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { ready, analyzing, ear, drowsy, start, stop };
}