// src/useYamnetSnore.ts
import { useCallback, useEffect, useRef, useState } from "react";

type MPFilesetResolver = any;
type MPAudioClassifier = any;

export function useYamnetSnore(opts: {
  threshold?: number;        // 0..1
  dwellMs?: number;          // ms
  keywords?: string[];       // labels to match (lowercased substrings)
  onSnore?: () => void;      // callback when detected
} = {}) {
  const {
    threshold = 0.6,
    dwellMs = 250,
    keywords = ["snor"],     // default = snore/snoring
    onSnore,
  } = opts;

  const [ready, setReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState(0);
  const [lastLabel, setLastLabel] = useState<string>("");

  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const classifierRef = useRef<any>(null);
  const aboveSinceRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    try {
      procRef.current?.disconnect();
      srcRef.current?.disconnect();
      procRef.current = null;
      srcRef.current = null;

      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;

      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch {}
    setMicReady(false);
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const mod = await import("@mediapipe/tasks-audio");
      const { FilesetResolver, AudioClassifier } = mod as {
        FilesetResolver: MPFilesetResolver;
        AudioClassifier: MPAudioClassifier;
      };

      const fileset = await FilesetResolver.forAudioTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio/wasm"
      );

      const audioClassifier = await AudioClassifier.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://tfhub.dev/google/lite-model/yamnet/classification/tflite/1?lite-format=tflite",
        },
        maxResults: 5,
      });
      classifierRef.current = audioClassifier;
      setReady(true);
    } catch (e: any) {
      setError(e?.message || "Failed to load YAMNet/MediaPipe.");
    }
  }, []);

  const start = useCallback(async () => {
    if (!classifierRef.current) await load();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ac = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ac;

      const src = ac.createMediaStreamSource(stream);
      srcRef.current = src;

      const proc = ac.createScriptProcessor(16384, 1, 1);
      procRef.current = proc;

      src.connect(proc);
      proc.connect(ac.destination); // keep or route to a GainNode(0) to silence

      setMicReady(true);

      proc.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const result = classifierRef.current.classify(input);
        if (result?.length) {
          const cats = result[0].classifications[0].categories ?? [];
          const match = cats.find((c: any) => {
            const name = String(c.categoryName || c.displayName || "").toLowerCase();
            return keywords.some(k => name.includes(k));
          });

          const top = cats[0];
          setLastLabel((match?.categoryName || top?.categoryName || "") as string);
          setLastScore((match?.score ?? top?.score ?? 0) as number);

          const now = performance.now();
          if (match && (match.score || 0) >= threshold) {
            if (aboveSinceRef.current == null) aboveSinceRef.current = now;
            if (now - (aboveSinceRef.current ?? now) >= dwellMs) {
              aboveSinceRef.current = null;
              onSnore?.();
            }
          } else {
            aboveSinceRef.current = null;
          }
        }
      };
    } catch (e: any) {
      setError(e?.message || "Microphone error");
      stop();
    }
  }, [dwellMs, keywords, load, onSnore, stop, threshold]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    ready,
    micReady,
    error,
    lastLabel,
    lastScore,
    load,
    start,
    stop,
  };
}