import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { beep } from './beep';
import { useFaceAwake } from './useFaceAwake';
import { useFaceActivity } from './useFaceActivity';

function App() {
  const [focusDuration, setFocusDuration] = useState(1.5); // hours
  const [showVideo, setShowVideo] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inputText, setInputText] = useState(''); // Text input for Gemini

  // Webcam state
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Timer refs
  const progressIntervalRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(0);
  const sessionMsRef = useRef<number>(0);

  // Keep simple booleans in refs for effects/beeps
  const isRunningRef = useRef(isRunning);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  // Face detection — eyes closed + head down
  const face = useFaceAwake({
    videoRef,
    earThreshold: 0.18,
    eyeDwellMs: 600,
    headDownOnDeg: 15,
    headDownOffDeg: 12,
    headDwellMs: 5000,
    emaAlpha: 0.15,
    onEyeDrowsy: () => { if (isRunningRef.current) beep(500, 1000); },
    onHeadDown: () => { if (isRunningRef.current) beep(500, 800); },
  });

  // Facial motion idle detector (no keyboard/mouse needed)
  const faceActivity = useFaceActivity(face.ear, face.pitchDeg, { idleMs: 10000 });
  const idleRef = useRef(faceActivity.idle);
  useEffect(() => { idleRef.current = faceActivity.idle; }, [faceActivity.idle]);

  // Idle beeping (repeat while idle)
  const idleBeepIntervalRef = useRef<number | null>(null);
  useEffect(() => {
    const stopIdleBeep = () => {
      if (idleBeepIntervalRef.current) {
        window.clearInterval(idleBeepIntervalRef.current);
        idleBeepIntervalRef.current = null;
      }
    };

    if (!isRunningRef.current) {
      stopIdleBeep();
      return;
    }

    if (faceActivity.idle) {
      if (!idleBeepIntervalRef.current) {
        // immediate beep, then every 3s while still idle
        beep(250, 900);
        idleBeepIntervalRef.current = window.setInterval(() => {
          if (isRunningRef.current && idleRef.current) beep(250, 900);
        }, 3000);
      }
    } else {
      stopIdleBeep();
    }

    return () => { /* interval cleared in next run/stop */ };
  }, [faceActivity.idle]);

  // --- Gemini: send input to backend when session starts (optional) ---
  const sendToGemini = async () => {
    try {
      const res = await fetch("http://localhost:5001/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      alert(`Gemini says: ${data.response}`);
    } catch (err: any) {
      alert(err.message || "Could not reach the Gemini backend.");
    }
  };

  // Webcam functions (reliable init & attach)
  const startWebcam = async () => {
    try {
      setWebcamError(null);
      // If an old stream exists, stop it cleanly
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }

      // Request a fresh camera stream with stable constraints
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(mediaStream);

      // Attach to the <video> element (the ref might not be ready immediately)
      const attach = () => {
        const v = videoRef.current;
        if (v) {
          (v as any).srcObject = mediaStream;
          // Attempt to play; ignore the promise rejection if autoplay is blocked
          v.play?.().catch(() => {});
        } else {
          setTimeout(attach, 150);
        }
      };
      attach();

      // Wait until the video has real frames (non-zero intrinsic size)
      await new Promise<void>((resolve, reject) => {
        let tries = 0;
        const maxTries = 200; // ~5 seconds total (200 * 25ms)
        const check = () => {
          const v = videoRef.current;
          if (
            v &&
            v.videoWidth > 0 &&
            v.videoHeight > 0 &&
            v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            resolve();
            return;
          }
          if (tries++ >= maxTries) {
            reject(new Error('Video not ready (dimensions are zero)'));
            return;
          }
          setTimeout(check, 25);
        };
        check();
      });
    } catch (error: any) {
      console.error('Error accessing webcam:', error);
      setWebcamError('Unable to access webcam. Please check permissions.');
      throw error;
    }
  };

  const stopWebcam = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    const v = videoRef.current;
    if (v) (v as any).srcObject = null;
  };

  // Attach stream to <video> if it changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    (v as any).srcObject = stream;
    v.play?.().catch(() => {});
  }, [stream]);

  // Full cleanup on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
      if (idleBeepIntervalRef.current) {
        window.clearInterval(idleBeepIntervalRef.current);
        idleBeepIntervalRef.current = null;
      }
      face.stop();
      stopWebcam();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional: pause/resume gracefully when tab goes hidden/visible
  useEffect(() => {
    const onVis = async () => {
      if (document.hidden) {
        face.stop();
      } else if (isRunning) {
        await startWebcam();
        await face.start();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Timer progress
  const startTiming = () => {
    sessionMsRef.current = Math.max(0.1, focusDuration) * 60 * 60 * 1000;
    sessionStartRef.current = Date.now();

    if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - sessionStartRef.current;
      const pct = Math.min(100, (elapsed / sessionMsRef.current) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
        setIsRunning(false);
        face.stop();
        stopWebcam();
        if (idleBeepIntervalRef.current) {
          window.clearInterval(idleBeepIntervalRef.current);
          idleBeepIntervalRef.current = null;
        }
      }
    }, 250);
  };

  const handleStart = async () => {
    setIsRunning(true);
    await startWebcam();
    await face.start();   // start landmark analysis after video is live
    startTiming();

    // Send the user's input text to Gemini when session starts
    if (inputText.trim().length > 0) {
      await sendToGemini();
    }
  };

  const handleStop = () => {
    setIsRunning(false);
    setProgress(0);
    face.stop();
    stopWebcam();

    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (idleBeepIntervalRef.current) {
      window.clearInterval(idleBeepIntervalRef.current);
      idleBeepIntervalRef.current = null;
    }
  };

  const toggleVideo = async () => {
    const nextShow = !showVideo;
    setShowVideo(nextShow);
    if (nextShow && isRunning) {
      await startWebcam();
      await face.start();
    } else if (!nextShow && isRunning) {
      face.stop();
      stopWebcam();
    }
  };

  // Remaining time
  const remainingMs = Math.max(0, sessionMsRef.current - (Date.now() - sessionStartRef.current));
  const mm = Math.floor(remainingMs / 60000).toString().padStart(2, '0');
  const ss = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');

  return (
    <div className="min-h-screen bg-dark-bg text-soft-white font-sans">
      {/* Header */}
      <header className="pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2">
          <img
            src="/logo.svg"
            alt="RU Snoozing Logo"
            style={{ width: '140px', height: '110px' }}
            className="mb-1"
          />
          <h1 className="text-3xl font-bold text-center">RU Snoozing</h1>
          <p className="text-lg text-gray-400 text-center">Stay awake. Stay focused.</p>
        </div>
      </header>

      <main className="flex flex-col items-center px-6 max-w-4xl mx-auto">
        {/* Video */}
        <div className="relative mb-2">
          {showVideo ? (
            <div
              className={`w-96 h-64 rounded-lg border-2 overflow-hidden transition-all ${
                face.eyeDrowsy || face.headDown
                  ? 'border-red-500 ring-2 ring-red-500'
                  : 'border-gray-700'
              }`}
            >
              {stream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-gray-400">{webcamError || 'Click Start to begin'}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-96 h-64 bg-gray-900 rounded-lg border-2 border-gray-700 flex items-center justify-center">
              <p className="text-gray-500">Video Hidden</p>
            </div>
          )}

          {/* Privacy Toggle */}
          <button
            onClick={toggleVideo}
            className="absolute top-4 right-4 bg-gray-700 hover:bg-gray-600 rounded-full p-2 transition-colors"
            title="Toggle video preview"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              {showVideo ? (
                <path
                  fillRule="evenodd"
                  d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                  clipRule="evenodd"
                />
              ) : (
                <>
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path
                    fillRule="evenodd"
                    d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                    clipRule="evenodd"
                  />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Status */}
        <div className="mb-6 text-sm text-gray-300 flex items-center gap-4">
          <span>Eyes: {face.eyeDrowsy ? 'Closed (alert)' : 'Open'}</span>
          <span>Head: {face.headDown ? 'Down (alert)' : 'Level'}</span>
          <span className="text-gray-400">EAR: {face.ear.toFixed(3)} • Pitch: {face.pitchDeg.toFixed(1)}°</span>
          <span className="text-gray-500">Face motion: {faceActivity.idle ? 'idle' : 'active'}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6 mb-8">
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="px-8 py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
          >
            Start
          </button>
          <button
            onClick={handleStop}
            disabled={!isRunning}
            className="px-8 py-4 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 text-white font-semibold rounded-lg border border-gray-500 transition-colors"
          >
            Stop
          </button>

          <button
            onClick={() => beep(100, 1000)}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Test Beep
          </button>

          {isRunning && <div className="text-sm text-gray-400">Remaining: {mm}:{ss}</div>}
        </div>

        {/* Text Input Box - only before session (Gemini prompt) */}
        {!isRunning && (
          <div className="w-full max-w-md mb-6">
            <div className="space-y-2">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="How do you want to be kept awake? (e.g. pep talk, scary voice, motivation)"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Focus Duration Slider - only before session */}
        {!isRunning && (
          <div className="w-full max-w-md space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-lg font-medium">Focus Duration</label>
              <span className="text-xl font-bold text-green-400">
                {(() => {
                  const totalMinutes = Math.round(focusDuration * 60);
                  const hours = Math.floor(totalMinutes / 60);
                  const minutes = totalMinutes % 60;
                  return `${hours}h ${minutes}m`;
                })()}
              </span>
            </div>
            <input
              type="range"
              min="0.0833"
              max="3"
              step="0.0833"
              value={focusDuration}
              onChange={(e) => setFocusDuration(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #10B981 0%, #10B981 ${(focusDuration / 3) * 100}%, #374151 ${(focusDuration / 3) * 100}%, #374151 100%)`,
              }}
            />
            <div className="flex justify-between text-sm text-gray-400">
              <span>0.1h</span>
              <span>3h</span>
            </div>
          </div>
        )}

        {/* Progress Bar - only during session */}
        {isRunning && (
          <div className="w-full max-w-md space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Session Progress</span>
              <span className="text-sm text-gray-400">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;