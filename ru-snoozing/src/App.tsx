import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { beep } from './beep';
import { useFaceAwake } from './useFaceAwake';

function App() {
  const [focusDuration, setFocusDuration] = useState(1.5); // hours
  const [showVideo, setShowVideo] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // Webcam state
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Timer interval (browser type)
  const progressIntervalRef = useRef<number | null>(null);

  // Face drowsiness (EAR) detection
  const face = useFaceAwake({
    videoRef,
    earThreshold: 0.18,      // tune: 0.16–0.22
    dwellMs: 600,            // ms eyes must stay closed
    onDrowsy: () => beep(600, 880),
  });

  // Webcam functions
  const stopWebcam = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      (videoRef.current as HTMLVideoElement).srcObject = null;
    }
  };

  const startWebcam = async () => {
    try {
      // Stop existing stream before starting new one
      stopWebcam();
      setWebcamError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(mediaStream);

      // Delay to ensure video element is ready
      setTimeout(() => {
        if (videoRef.current) {
          try {
            videoRef.current.srcObject = mediaStream;
            console.log('Webcam stream attached successfully.');
          } catch (error) {
            console.error('Failed to attach webcam stream, retrying...', error);
            setTimeout(() => {
              if (videoRef.current) {
                try {
                  videoRef.current.srcObject = mediaStream;
                  console.log('Webcam stream attached on retry.');
                } catch (retryError) {
                  console.error('Retry failed to attach webcam stream:', retryError);
                  setWebcamError('Unable to access webcam. Please check permissions.');
                }
              }
            }, 300);
          }
        } else {
          console.error('Video ref is not available.');
          setWebcamError('Unable to access webcam. Please check permissions.');
        }
      }, 150);
    } catch (error) {
      console.error('Error accessing webcam:', error);
      setWebcamError('Unable to access webcam. Please check permissions.');
      throw error;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWebcam();
      if (progressIntervalRef.current) {
        window.clearInterval(progressIntervalRef.current);
      }
      face.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    setIsRunning(true);
    try {
      await startWebcam();
    } catch (error) {
      setIsRunning(false);
      return;
    }

    // Start face analysis once video is ready
    face.start();

    // Simple progress simulation (0→100)
    if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (progressIntervalRef.current) window.clearInterval(progressIntervalRef.current);
          setIsRunning(false);
          face.stop();
          stopWebcam();
          return 0;
        }
        return prev + 1;
      });
    }, 100);
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
  };

  const toggleVideo = () => {
    setShowVideo(!showVideo);
    if (!showVideo && isRunning) {
      startWebcam();
      face.start();
    } else if (showVideo && isRunning) {
      face.stop();
      stopWebcam();
    }
  };

  return (
    <div className="min-h-screen bg-dark-bg text-soft-white font-sans">
      {/* Header */}
      <header className="pt-8 pb-6">
        <div className="flex flex-col items-center space-y-4">
          <img src="/logo.svg" alt="RU Snoozing Logo" className="w-16 h-16" />
          <h1 className="text-3xl font-bold text-center">RU Snoozing</h1>
          <p className="text-lg text-gray-400 text-center">Stay awake. Stay focused.</p>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-col items-center px-6 max-w-4xl mx-auto">
        {/* Video Section */}
        <div className="relative mb-2">
          {showVideo ? (
            <div
              className={`w-96 h-64 rounded-lg border-2 overflow-hidden transition-all
              ${face.drowsy ? 'border-red-500 ring-2 ring-red-500' : 'border-gray-700'}`}
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
                    <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/>
                      </svg>
                    </div>
                    <p className="text-gray-400">
                      {webcamError ? 'Webcam Error' : 'Click Start to begin'}
                    </p>
                    {webcamError && <p className="text-red-400 text-sm mt-2">{webcamError}</p>}
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
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/>
              ) : (
                <>
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Awake/Drowsy status */}
        <div className="mb-6 text-sm text-gray-300 flex items-center gap-4">
          <span>
            Face: {face.ready ? (face.analyzing ? (face.drowsy ? 'DROWSY 😴' : 'Awake 😎') : 'ready') : 'loading...'}
          </span>
          <span className="text-gray-400">EAR: {face.ear.toFixed(3)}</span>
        </div>

        {/* Controls Row */}
        <div className="flex items-center gap-6 mb-8">
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="px-8 py-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors duration-200 flex items-center space-x-2"
          >
            <div className="w-3 h-3 bg-white rounded-full"></div>
            <span>Start</span>
          </button>

          <button
            onClick={handleStop}
            disabled={!isRunning}
            className="px-8 py-4 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg border border-gray-500 transition-colors duration-200 flex items-center space-x-2"
          >
            <div className="w-3 h-3 bg-white rounded-full"></div>
            <span>Stop</span>
          </button>

          {/* Test beep */}
          <button
            onClick={() => beep(500, 880)}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            title="Play a short test beep"
          >
            Test Beep
          </button>
        </div>

        {/* Focus Control Section */}
        <div className="w-full max-w-md space-y-6">
          {/* Focus Duration Slider */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-lg font-medium">Focus Duration</label>
              <span className="text-xl font-bold text-green-400">
                {focusDuration.toFixed(1)}h
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={focusDuration}
              onChange={(e) => setFocusDuration(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #10B981 0%, #10B981 ${(focusDuration / 3) * 100}%, #374151 ${(focusDuration / 3) * 100}%, #374151 100%)`
              }}
            />
            <div className="flex justify-between text-sm text-gray-400">
              <span>0h</span>
              <span>3h</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Session Progress</span>
              <span className="text-sm text-gray-400">{progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;