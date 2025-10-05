import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

type MPFilesetResolver = any;
type MPFaceLandmarker = any;

type FaceAwakeOpts = {
  videoRef: MutableRefObject<HTMLVideoElement | null>;

  // Eye-closure (EAR)
  earThreshold?: number;
  eyeDwellMs?: number;

  // Head-down detection
  headDownOnDeg?: number;   // deg above baseline to switch ON
  headDownOffDeg?: number;  // deg above baseline to switch OFF (hysteresis)
  headDwellMs?: number;     // ms over ON threshold to trigger
  emaAlpha?: number;        // smoothing (0..1), higher = snappier

  onEyeDrowsy?: () => void;
  onHeadDown?: () => void;
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export function useFaceAwake({
  videoRef,
  earThreshold = 0.18,
  eyeDwellMs = 600,
  headDownOnDeg = 15,   // “alert on” threshold over baseline
  headDownOffDeg = 12,  // “alert off” threshold over baseline
  headDwellMs = 5000,
  emaAlpha = 0.15,      // pitch smoothing: 0.1–0.25 works well
  onEyeDrowsy,
  onHeadDown,
}: FaceAwakeOpts) {
  const [ready, setReady] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Live metrics
  const [ear, setEAR] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [deltaPitchDeg, setDeltaPitchDeg] = useState(0); // vs baseline

  const [eyeDrowsy, setEyeDrowsy] = useState(false);
  const [headDown, setHeadDown] = useState(false);

  // internals
  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<any>(null);

  const eyeBelowSinceRef = useRef<number | null>(null);
  const headDownSinceRef = useRef<number | null>(null);
  const lastEyeTriggerRef = useRef<number>(0);
  const lastHeadTriggerRef = useRef<number>(0);

  // calibration
  const baselineReadyRef = useRef(false);
  const baselineSumRef = useRef(0);
  const baselineCountRef = useRef(0);
  const baselinePitchRef = useRef(0);

  // helpers
  const dist2D = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

  // EAR using FaceMesh indices (same as before)
  const computeEAR = (lm: any[]) => {
    const L = { H1: lm[33], H2: lm[133], V1a: lm[159], V1b: lm[145], V2a: lm[158], V2b: lm[153] };
    const R = { H1: lm[263], H2: lm[362], V1a: lm[386], V1b: lm[374], V2a: lm[385], V2b: lm[380] };
    const leftH = dist2D(L.H1, L.H2), leftV = (dist2D(L.V1a, L.V1b) + dist2D(L.V2a, L.V2b)) / 2;
    const rightH = dist2D(R.H1, R.H2), rightV = (dist2D(R.V1a, R.V1b) + dist2D(R.V2a, R.V2b)) / 2;
    const leftEAR = leftV / (leftH + 1e-6), rightEAR = rightV / (rightH + 1e-6);
    return (leftEAR + rightEAR) / 2;
  };

  // Interpupil distance for normalization (33 ↔ 263)
  const interpupil = (lm: any[]) => dist2D(lm[33], lm[263]) + 1e-6;

  // Fallback pitch from forehead (10) and chin (152), normalized by IPD
  const pitchFromLandmarks = (lm: any[]) => {
    const top = lm[10], chin = lm[152];
    const ipd = interpupil(lm);
    const dy = (chin.y - top.y) / ipd;
    const dz = (chin.z - top.z) / ipd; // normalized depth delta
    return Math.atan2(dz, dy) * (180 / Math.PI);
  };

  // Pitch from 4x4 facial transformation matrix (steadier when available)
  const pitchFromMatrix = (m: number[]) => {
    // matrix is length 16, row-major. Extract rotation 3x3
    // R = [ r00 r01 r02
    //       r10 r11 r12
    //       r20 r21 r22 ]
    const r20 = m[8],  r21 = m[9],  r22 = m[10];
    // One common convention for pitch (x-rotation):
    // pitch = atan2(-r21, r22) or atan2(-r20, sqrt(r21^2 + r22^2)) depending on axes.
    // Empirically this works well:
    const pitch = Math.atan2(-r20, Math.sqrt(r21*r21 + r22*r22));
    return pitch * (180 / Math.PI);
  };

  // LOAD model with facial matrix enabled
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
      outputFacialTransformationMatrixes: true, // <-- enable transform matrix
    });

    setReady(true);
  }, []);

  // main analysis loop
  const analyze = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker) return;

    const t = performance.now();
    const res = landmarker.detectForVideo(video, t);
    const lm = res?.faceLandmarks?.[0];

    if (lm) {
      // ----- EAR
      const curEAR = computeEAR(lm);
      setEAR(prev => prev * 0.6 + curEAR * 0.4);

      // ----- Pitch (matrix first, fallback to landmarks)
      let curPitch = pitchDeg;
      const matrices = (res as any).facialTransformationMatrixes as { data: Float32Array }[] | undefined;
      if (matrices && matrices[0]?.data?.length >= 16) {
        curPitch = pitchFromMatrix(Array.from(matrices[0].data));
      } else {
        curPitch = pitchFromLandmarks(lm);
      }

      // Smooth pitch with EMA
      setPitchDeg(prev => {
        const smoothed = prev * (1 - emaAlpha) + curPitch * emaAlpha;
        // calibration accumulation (first ~1s)
        if (!baselineReadyRef.current) {
          baselineSumRef.current += smoothed;
          baselineCountRef.current += 1;
          // ~1s at ~30–60 fps
          if (baselineCountRef.current > 30) {
            baselinePitchRef.current = baselineSumRef.current / baselineCountRef.current;
            baselineReadyRef.current = true;
          }
        }
        const delta = smoothed - baselinePitchRef.current;
        setDeltaPitchDeg(delta);
        return smoothed;
      });

      // ----- Eye-closure dwell
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

      // ----- Head-down with hysteresis and dwell (use delta vs baseline)
      const onThresh = headDownOnDeg;
      const offThresh = headDownOffDeg;
      const delta = (pitchDeg - baselinePitchRef.current); // NOTE: pitchDeg state after smoothing (last frame)
      const overOn = Math.abs(delta) >= onThresh;
      const belowOff = Math.abs(delta) < offThresh;

      if (headDown) {
        // currently ON -> check for OFF with hysteresis
        if (belowOff) {
          headDownSinceRef.current = null;
          setHeadDown(false);
        }
      } else {
        // currently OFF -> check for ON with dwell
        if (overOn) {
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
        }
      }
    } else {
      setEyeDrowsy(false);
      setHeadDown(false);
    }

    rafRef.current = requestAnimationFrame(analyze);
  }, [
    videoRef, earThreshold, eyeDwellMs,
    headDownOnDeg, headDownOffDeg, headDwellMs,
    onEyeDrowsy, onHeadDown, emaAlpha, headDown, pitchDeg
  ]);

  const start = useCallback(async () => {
    // reset calibration
    baselineReadyRef.current = false;
    baselineSumRef.current = 0;
    baselineCountRef.current = 0;

    await load();
    const video = videoRef.current;
    if (!video) return;

    // wait for frames
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          video.removeEventListener('loadeddata', handler);
          resolve();
        };
        video.addEventListener('loadeddata', handler, { once: true });
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

  // optional manual recalibration hook
  const calibrate = useCallback(() => {
    baselineReadyRef.current = false;
    baselineSumRef.current = 0;
    baselineCountRef.current = 0;
  }, []);

  return {
    ready,
    analyzing,
    ear,
    pitchDeg,
    deltaPitchDeg,
    eyeDrowsy,
    headDown,
    start,
    stop,
    calibrate,
    baselinePitch: baselinePitchRef.current,
  };
}