import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '../stores/configStore'
import { onStreamReady, onDetectionsUpdate, Detection } from '../hooks/useWebRTC'
import { useDetectionCanvas } from '../hooks/useDetectionCanvas'
import StatusBar from './StatusBar'
import Avatar3D from './Avatar3D'

interface Props {
  eventType: string
}

export default function EventScreen({ eventType }: Props) {
  const { config, clearEvent } = useAppStore()
  const [speaking, setSpeaking]   = useState(false)
  const [camStream, setCamStream] = useState<MediaStream | null>(null)
  const [detections, setDetections] = useState<Detection[]>([])
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const leftVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)

  // Subscribe to the singleton WebRTC stream shared across all views.
  useEffect(() => onStreamReady((s) => setCamStream(s)), [])

  // Subscribe to YOLOX detections pushed over Socket.IO.
  useEffect(() => onDetectionsUpdate(setDetections), [])

  // Attach the shared WebRTC stream to the local video element.
  useEffect(() => {
    if (!leftVideoRef.current || !camStream) return
    leftVideoRef.current.srcObject = camStream
    leftVideoRef.current.play().catch(() => {})
  }, [camStream])

  // Draw detection bounding boxes on the canvas overlay.
  useDetectionCanvas(leftVideoRef, canvasRef, detections)

  // Resolve the alert message for this event type, falling back to 'unknown'.
  const message = useMemo(() => {
    return (
      config.eventMessages.find((m) => m.trigger === eventType)?.message
      ?? config.eventMessages.find((m) => m.trigger === 'unknown')?.message
      ?? 'Event detected.'
    )
  }, [eventType, config.eventMessages])

  const speak = useCallback((text: string) => {
    if (!config.avatarVoiceEnabled || !('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()
    window.speechSynthesis.resume()  // Chrome Linux bug: cancel() leaves synth paused
    const u   = new SpeechSynthesisUtterance(text)
    u.rate    = 0.95
    u.pitch   = 0.9
    u.volume  = 1

    // Prefer a female English voice; fall back to any English voice.
    const voices    = window.speechSynthesis.getVoices()
    const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female'))
      ?? voices.find(v => v.lang.startsWith('en'))
    if (preferred) u.voice = preferred

    u.onstart = () => setSpeaking(true)
    u.onend   = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)

    utteranceRef.current = u
    window.speechSynthesis.speak(u)
  }, [config.avatarVoiceEnabled])

  // Trigger speech 400 ms after mount (lets voices list load first).
  useEffect(() => {
    const timer = setTimeout(() => speak(message), 400)
    return () => {
      clearTimeout(timer)
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [message, speak])

  // Warm up the voice list on mount so it is populated when speak() fires.
  useEffect(() => {
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices()
  }, [])

  return (
    <div className="w-full h-full flex flex-col animate-fade-in">
      <StatusBar />

      <div className="flex-1 flex pt-9 pb-2 px-2 gap-2">
        {/* Left: live camera feed with detection overlay */}
        <div className="flex-1 relative">
          <div className="relative w-full h-full rounded-xl overflow-hidden glow-border bg-black">
            <video
              ref={leftVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Detection bounding-box canvas */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 pointer-events-none z-10"
              style={{ width: '100%', height: '100%' }}
            />

            {/* Event type badge */}
            <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30
                text-[10px] font-orbitron font-semibold text-red-400 tracking-wider uppercase">
                {eventType}
              </span>
            </div>

            {/* Live timestamp */}
            <div className="absolute bottom-2 left-2 z-20 px-2 py-0.5 rounded-md bg-black/50 backdrop-blur-sm
              text-[9px] font-mono text-white/40">
              {new Date().toLocaleTimeString()} — LIVE
            </div>

            {/* Motion zone overlay */}
            <div
              className="absolute z-20 border border-cyber-blue/20 rounded pointer-events-none"
              style={{
                left:   `${config.motionZone.x * 100}%`,
                top:    `${config.motionZone.y * 100}%`,
                width:  `${config.motionZone.width * 100}%`,
                height: `${config.motionZone.height * 100}%`,
              }}
            >
              <div className="absolute -top-3.5 left-0 text-[7px] font-mono text-cyber-blue/30 tracking-wider">
                DETECTION ZONE
              </div>
            </div>

            {/* Dismiss button */}
            <button
              onClick={clearEvent}
              className="absolute top-2 right-2 z-20 px-2 py-1 rounded-lg bg-white/5 border border-white/10
                text-[9px] font-inter text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
            >
              ESC ✕
            </button>
          </div>
        </div>

        {/* Right: avatar + alert message panel */}
        <div className="w-[280px] flex flex-col gap-2">
          <div className="flex-1 relative rounded-xl overflow-hidden glow-border bg-cyber-panel">
            <Avatar3D speaking={speaking} />
          </div>

          <div className="rounded-xl p-3 glow-border bg-cyber-panel animate-slide-up">
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyber-blue to-cyber-purple flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </div>
              <span className="text-[10px] font-orbitron font-semibold text-cyber-blue tracking-wider uppercase">
                Alert Report
              </span>
              {speaking && (
                <div className="ml-auto flex items-center gap-1">
                  <div className="w-1 h-3 bg-cyber-blue/60 rounded-full animate-pulse" />
                  <div className="w-1 h-4 bg-cyber-blue/80 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }} />
                  <div className="w-1 h-2 bg-cyber-blue/50 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }} />
                </div>
              )}
            </div>

            <div className="w-full h-[1px] bg-gradient-to-r from-cyber-blue/20 via-cyber-purple/20 to-transparent mb-2" />

            <p className="text-xs font-rajdhani font-medium text-white/70 leading-relaxed">
              {message}
            </p>

            <div className="mt-2 flex items-center gap-3 text-[8px] font-mono text-white/25">
              <span>TYPE: {eventType.toUpperCase()}</span>
              <span>CONF: 0.92</span>
              <span>CAM: FRONT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
