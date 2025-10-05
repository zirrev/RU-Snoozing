// src/useFaceAwake.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

type MPFilesetResolver = any;
type MPFaceLandmarker = any;

type FaceAwakeOpts = {
  videoRef: MutableRefObject<HTMLVideoElement | null>;

  // Eye-closure (EAR) options
  earThreshold?: number;     // lower => more sensitive to "closed"
  eyeDwellMs?: number;       // ms EAR must stay below threshold

  // Head-down options
  headDownPitchDeg?: number; // degrees (downward tilt threshold)
  headDwellMs?: number;      // ms pitch must exceed threshold

  onEyeDrowsy?: () => void;  // called when eyes closed sustained
  onHeadDown?: () => void;   // called when head down sustained
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useFaceAwake({
  videoRef,
  earThreshold = 0.18,
  eyeDwellMs = 600,
  headDownPitchDeg = 15,      // tune 12–20
  headDwellMs = 5000,         // 5 seconds as requested
  onEyeDrowsy,
  onHeadDown,
}: FaceAwakeOpts) {
  const [ready, setReady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [ear, setEAR] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [eyeDrowsy, setEyeDrowsy] = useState(false);
  const [headDown, setHeadDown] = useState(false);

  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<any>(null);

  const eyeBelowSinceRef = useRef<number | null>(null);
  const headDownSinceRef = useRef<number | null>(null);
  const lastEyeTriggerRef = useRef<number>(0);
  const lastHeadTriggerRef = useRef<number>(0);

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

    landmarkerRef.current = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    setReady(true);
  }, []);

  // --- helpers
  const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
  // EAR using FaceMesh indices
  const computeEAR = (lm: any[]) => {
    const L = { H1: lm[33], H2: lm[133], V1a: lm[159], V1b: lm[145], V2a: lm[158], V2b: lm[153] };
    const R = { H1: lm[263], H2: lm[362], V1a: lm[386], V1b: lm[374], V2a: lm[385], V2b: lm[380] };
    const leftH = dist(L.H1, L.H2), leftV = (dist(L.V1a, L.V1b) + dist(L.V2a, L.V2b)) / 2;
    const rightH = dist(R.H1, R.H2), rightV = (dist(R.V1a, R.V1b) + dist(R.V2a, R.V2b)) / 2;
    const leftEAR = leftV / (leftH + 1e-6), rightEAR = rightV / (rightH + 1e-6);
    return (leftEAR + rightEAR) / 2;
  };

  /**
   * Approximate pitch (downward tilt) using forehead (10) and chin (152) 3D landmarks.
   * We look at the vector from forehead -> chin in (y, z) plane:
   *   pitch = atan2(Δz, Δy) in degrees
   * Positive pitch means chin is more forward relative to forehead (head down toward camera).
   * Threshold is tunable in degrees.
   */
  const computePitchDeg = (lm: any[]) => {
    const top = lm[10];   // forehead / top
    const chin = lm[152]; // chin
    const dy = (chin.y - top.y);
    const dz = (chin.z - top.z); // MediaPipe z is in image coords; sign may vary by device, but relative change works
    const angle = Math.atan2(dz, dy) * (180 / Math.PI);
    return angle;
  };

  // --- analysis loop
  const analyze = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    const t = performance.now();
    const res = landmarker.detectForVideo(video, t);
    const face = res?.faceLandmarks?.[0];

    if (face) {
      // EAR
      const curEAR = computeEAR(face);
      setEAR((prev) => prev * 0.6 + curEAR * 0.4);

      // Pitch
      const curPitch = computePitchDeg(face);
      setPitchDeg((prev) => prev * 0.7 + curPitch * 0.3);

      // Eye drowsy dwell
      if (curEAR < earThreshold) {
        if (eyeBelowSinceRef.current == null) eyeBelowSinceRef.current = t;
        if (t - (eyeBelowSinceRef.current ?? t) >= eyeDwellMs) {
          if (t - lastEyeTriggerRef.current > eyeDwellMs) {
            setEyeDrowsy(true);
            lastEyeTriggerRef.current = t;
            onEyeDrowsy?.();
          }
        }
      } else {
        eyeBelowSinceRef.current = null;
        setEyeDrowsy(false);
      }

      // Head-down dwell
      if (Math.abs(curPitch) >= headDownPitchDeg) {
        if (headDownSinceRef.current == null) headDownSinceRef.current = t;
        if (t - (headDownSinceRef.current ?? t) >= headDwellMs) {
          if (t - lastHeadTriggerRef.current > headDwellMs) {
            setHeadDown(true);
            lastHeadTriggerRef.current = t;
            onHeadDown?.();
          }
        }
      } else {
        headDownSinceRef.current = null;
        setHeadDown(false);
      }
    } else {
      setEyeDrowsy(false);
      setHeadDown(false);
    }

    rafRef.current = requestAnimationFrame(analyze);
  }, [videoRef, earThreshold, eyeDwellMs, headDownPitchDeg, headDwellMs, onEyeDrowsy, onHeadDown]);

  // --- public controls
  const start = useCallback(async () => {
    await load();
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setAnalyzing(true);
    rafRef.current = requestAnimationFrame(analyze);
  }, [analyze, load, videoRef]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setAnalyzing(false);
    setEyeDrowsy(false);
    setHeadDown(false);
    eyeBelowSinceRef.current = null;
    headDownSinceRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    ready,
    analyzing,
    // live metrics (for UI/debug)
    ear,
    pitchDeg,
    eyeDrowsy,
    headDown,
    // controls
    start,
    stop,
  };
}