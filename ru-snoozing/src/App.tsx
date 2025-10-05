import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { beep } from './beep';
import { useFaceAwake } from './useFaceAwake';
import { useFaceActivity } from './useFaceActivity';

function App() {
  const [focusDuration, setFocusDuration] = useState(1.5);
  const [showVideo, setShowVideo] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [inputText, setInputText] = useState('');
  const [darkMode, setDarkMode] = useState(true);
  
  // Session stats
  const [totalBeeps, setTotalBeeps] = useState(0);
  const [eyeCloseCount, setEyeCloseCount] = useState(0);
  const [headDownCount, setHeadDownCount] = useState(0);
  const [ttsTriggered, setTtsTriggered] = useState(0);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const progressIntervalRef = useRef<number | null>(null);
  const sessionStartRef = useRef<number>(0);
  const sessionMsRef = useRef<number>(0);

  const beepCountRef = useRef<number>(0);
  const lastTTSTimeRef = useRef<number>(0);

  const isRunningRef = useRef(isRunning);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);

  const inputTextRef = useRef(inputText);
  useEffect(() => { inputTextRef.current = inputText; }, [inputText]);

  const sendToGemini = async () => {
    const now = Date.now();
    if (now - lastTTSTimeRef.current < 30000) {
      console.log("🚫 TTS on cooldown, skipping...");
      return;
    }
    lastTTSTimeRef.current = now;

    try {
      console.log("🎙️ Sending to Gemini for TTS...");
      const textToSend = inputTextRef.current.trim() || "motivation";
      const res = await fetch("http://localhost:5001/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSend }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("✅ Gemini response:", data.response);
      setTtsTriggered(prev => prev + 1);
    } catch (err: any) {
      console.error("❌ Gemini backend error:", err.message);
    }
  };

  const handleBeepEvent = (type: 'eye' | 'head' | 'idle') => {
    beepCountRef.current += 1;
    setTotalBeeps(prev => prev + 1);
    
    if (type === 'eye') setEyeCloseCount(prev => prev + 1);
    if (type === 'head') setHeadDownCount(prev => prev + 1);
    
    console.log(`🔔 Beep event #${beepCountRef.current}`);
    
    if (beepCountRef.current >= 3) {
      console.log("🎯 3 beeps reached! Triggering TTS...");
      beepCountRef.current = 0;
      sendToGemini();
    }
  };

  const face = useFaceAwake({
    videoRef,
    earThreshold: 0.18,
    eyeDwellMs: 600,
    headDownOnDeg: 15,
    headDownOffDeg: 12,
    headDwellMs: 5000,
    emaAlpha: 0.15,
    onEyeDrowsy: () => { 
      if (isRunningRef.current) {
        beep(500, 1000);
        handleBeepEvent('eye');
      }
    },
    onHeadDown: () => { 
      if (isRunningRef.current) {
        beep(500, 800);
        handleBeepEvent('head');
      }
    },
  });

  const faceActivity = useFaceActivity(face.ear, face.pitchDeg, { idleMs: 10000 });
  const idleRef = useRef(faceActivity.idle);
  useEffect(() => { idleRef.current = faceActivity.idle; }, [faceActivity.idle]);

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
        beep(250, 900);
        handleBeepEvent('idle');
        idleBeepIntervalRef.current = window.setInterval(() => {
          if (isRunningRef.current && idleRef.current) {
            beep(250, 900);
            handleBeepEvent('idle');
          }
        }, 3000);
      }
    } else {
      stopIdleBeep();
    }

    return () => { };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceActivity.idle]);

  const startWebcam = async () => {
    try {
      setWebcamError(null);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        setStream(null);
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(mediaStream);

      const attach = () => {
        const v = videoRef.current;
        if (v) {
          (v as any).srcObject = mediaStream;
          v.play?.().catch(() => {});
        } else {
          setTimeout(attach, 150);
        }
      };
      attach();

      await new Promise<void>((resolve, reject) => {
        let tries = 0;
        const maxTries = 200;
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

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    (v as any).srcObject = stream;
    v.play?.().catch(() => {});
  }, [stream]);

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
    beepCountRef.current = 0;
    lastTTSTimeRef.current = 0;
    setTotalBeeps(0);
    setEyeCloseCount(0);
    setHeadDownCount(0);
    setTtsTriggered(0);
    setIsRunning(true);
    await startWebcam();
    await face.start();
    startTiming();
  };

  const handleStop = () => {
    setIsRunning(false);
    setProgress(0);
    beepCountRef.current = 0;
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

  const remainingMs = Math.max(0, sessionMsRef.current - (Date.now() - sessionStartRef.current));
  const mm = Math.floor(remainingMs / 60000).toString().padStart(2, '0');
  const ss = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');

  const bgClass = darkMode ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900' : 'bg-gradient-to-br from-blue-50 via-white to-indigo-50';
  const textClass = darkMode ? 'text-white' : 'text-gray-900';
  const cardBg = darkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-white/80 border-gray-200';
  const inputBg = darkMode ? 'bg-slate-700 border-slate-600 text-white placeholder-gray-400' : 'bg-gray-50 border-gray-300 text-gray-900 placeholder-gray-500';

  return (
    <div className={`min-h-screen ${bgClass} ${textClass} font-sans transition-all duration-300`}>
      {/* Dark Mode Toggle */}
      <button
        onClick={() => setDarkMode(!darkMode)}
        className={`fixed top-6 right-6 p-3 rounded-full ${darkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300'} transition-all shadow-lg z-50`}
        title="Toggle dark mode"
      >
        {darkMode ? (
          <svg className="w-6 h-6 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-slate-700" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        )}
      </button>

      {/* Header */}
      <header className="pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2">
          <img
            src="/logo.svg"
            alt="RU Snoozing Logo"
            style={{ width: '140px', height: '110px' }}
            className="mb-1 drop-shadow-lg"
          />
          <h1 className="text-4xl font-bold text-center bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
            RU Snoozing
          </h1>
          <p className={`text-lg text-center ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Stay awake. Stay focused. Stay productive.
          </p>
        </div>
      </header>

      {/* Main Layout - 3 columns */}
      <main className="flex gap-6 px-6 max-w-7xl mx-auto">
        {/* Left Sidebar - Stats */}
        <aside className={`w-64 space-y-4 ${!isRunning && 'opacity-50'}`}>
          <div className={`p-4 rounded-xl ${cardBg} border backdrop-blur-sm`}>
            <h3 className="text-sm font-semibold mb-3 opacity-70">Session Stats</h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs opacity-60">Total Alerts</p>
                <p className="text-2xl font-bold text-red-500">{totalBeeps}</p>
              </div>
              <div>
                <p className="text-xs opacity-60">Eye Closes</p>
                <p className="text-xl font-semibold text-orange-500">{eyeCloseCount}</p>
              </div>
              <div>
                <p className="text-xs opacity-60">Head Drops</p>
                <p className="text-xl font-semibold text-yellow-500">{headDownCount}</p>
              </div>
              <div>
                <p className="text-xs opacity-60">Voice Alerts</p>
                <p className="text-xl font-semibold text-blue-500">{ttsTriggered}</p>
              </div>
            </div>
          </div>

          {isRunning && (
            <div className={`p-4 rounded-xl ${cardBg} border backdrop-blur-sm`}>
              <h3 className="text-sm font-semibold mb-2 opacity-70">Time Remaining</h3>
              <p className="text-3xl font-mono font-bold text-green-400">{mm}:{ss}</p>
            </div>
          )}

          <div className={`p-4 rounded-xl ${cardBg} border backdrop-blur-sm`}>
            <h3 className="text-sm font-semibold mb-2 opacity-70">Detection Status</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span>EAR</span>
                <span className="font-mono">{face.ear.toFixed(3)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pitch</span>
                <span className="font-mono">{face.pitchDeg.toFixed(1)}°</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Motion</span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${faceActivity.idle ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                  {faceActivity.idle ? 'IDLE' : 'ACTIVE'}
                </span>
              </div>
            </div>
          </div>
        </aside>

        {/* Center - Video and Controls */}
        <div className="flex-1 flex flex-col items-center space-y-6">
          {/* Video */}
          <div className="relative">
            {showVideo ? (
              <div
                className={`w-[640px] h-[480px] rounded-2xl border-2 overflow-hidden transition-all shadow-2xl ${
                  face.eyeDrowsy || face.headDown
                    ? 'border-red-500 ring-4 ring-red-500/50'
                    : darkMode ? 'border-slate-600' : 'border-gray-300'
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
                  <div className="w-full h-full flex items-center justify-center bg-slate-900">
                    <div className="text-center">
                      <p className="text-gray-400">{webcamError || 'Click Start to begin'}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className={`w-[640px] h-[480px] ${darkMode ? 'bg-slate-700' : 'bg-gray-200'} rounded-2xl border-2 ${darkMode ? 'border-slate-600' : 'border-gray-300'} flex items-center justify-center shadow-2xl`}>
                <p className={darkMode ? 'text-gray-500' : 'text-gray-400'}>Video Hidden</p>
              </div>
            )}

            {/* Privacy Toggle */}
            <button
              onClick={toggleVideo}
              className={`absolute top-4 right-4 ${darkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-white hover:bg-gray-100'} rounded-full p-3 transition-all shadow-lg`}
              title="Toggle video preview"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                {showVideo ? (
                  <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                ) : (
                  <>
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                  </>
                )}
              </svg>
            </button>

            {/* Alert Status Badge */}
            {(face.eyeDrowsy || face.headDown) && (
              <div className="absolute top-4 left-4 bg-red-500 text-white px-4 py-2 rounded-full font-semibold animate-pulse shadow-lg">
                ⚠️ {face.eyeDrowsy ? 'Eyes Closed!' : 'Head Down!'}
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleStart}
              disabled={isRunning}
              className="px-10 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-xl transition-all shadow-lg disabled:opacity-50 transform hover:scale-105 active:scale-95"
            >
              Start Session
            </button>
            <button
              onClick={handleStop}
              disabled={!isRunning}
              className={`px-10 py-4 ${darkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300'} disabled:opacity-50 font-bold rounded-xl border-2 ${darkMode ? 'border-slate-600' : 'border-gray-300'} transition-all shadow-lg transform hover:scale-105 active:scale-95`}
            >
              Stop Session
            </button>
            <button
              onClick={() => beep(100, 1000)}
              className={`px-4 py-4 ${darkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300'} rounded-xl text-sm transition-all shadow`}
              title="Test beep sound"
            >
              🔔
            </button>
          </div>

          {/* Progress Bar - during session */}
          {isRunning && (
            <div className={`w-full max-w-2xl p-6 rounded-xl ${cardBg} border backdrop-blur-sm`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-semibold">Session Progress</span>
                <span className="text-sm font-mono">{Math.round(progress)}%</span>
              </div>
              <div className={`w-full ${darkMode ? 'bg-slate-700' : 'bg-gray-200'} rounded-full h-4 overflow-hidden`}>
                <div
                  className="bg-gradient-to-r from-green-500 to-emerald-500 h-4 rounded-full transition-all duration-300 shadow-lg"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Config */}
        <aside className="w-80 space-y-4">
          {!isRunning && (
            <>
              <div className={`p-6 rounded-xl ${cardBg} border backdrop-blur-sm`}>
                <h3 className="text-sm font-semibold mb-4 opacity-70">Voice Alert Style</h3>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="e.g., pep talk, scary voice, drill sergeant, friendly reminder"
                  className={`w-full px-4 py-3 ${inputBg} border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none`}
                  rows={4}
                />
                <p className={`text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  Describe how you want to be alerted after 3 beeps
                </p>
              </div>

              <div className={`p-6 rounded-xl ${cardBg} border backdrop-blur-sm`}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-semibold opacity-70">Focus Duration</h3>
                  <span className="text-2xl font-bold text-green-400">
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
                  className="w-full h-3 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #10B981 0%, #10B981 ${(focusDuration / 3) * 100}%, ${darkMode ? '#374151' : '#E5E7EB'} ${(focusDuration / 3) * 100}%, ${darkMode ? '#374151' : '#E5E7EB'} 100%)`,
                  }}
                />
                <div className={`flex justify-between text-xs mt-2 ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                  <span>5min</span>
                  <span>3h</span>
                </div>
              </div>

              <div className={`p-6 rounded-xl ${cardBg} border backdrop-blur-sm`}>
                <h3 className="text-sm font-semibold mb-3 opacity-70">How It Works</h3>
                <ol className={`text-xs space-y-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <li className="flex gap-2">
                    <span className="font-bold text-green-500">1.</span>
                    <span>Face detection monitors your eyes and head position</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-yellow-500">2.</span>
                    <span>Beeps alert you when drowsiness is detected</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-blue-500">3.</span>
                    <span>After 3 beeps, AI voice message plays</span>
                  </li>
                </ol>
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;