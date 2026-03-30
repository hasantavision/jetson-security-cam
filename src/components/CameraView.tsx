import { useRef } from 'react'
import { useWebRTC } from '../hooks/useWebRTC'
import { useDetectionCanvas } from '../hooks/useDetectionCanvas'

interface Props {
  className?: string
}

export default function CameraView({ className }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { status, detections } = useWebRTC(videoRef)

  // Draw YOLOX detection boxes on the overlay canvas.
  useDetectionCanvas(videoRef, canvasRef, detections)

  return (
    <div className={`relative w-full h-full ${className ?? ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />

      {/* Detection overlay canvas — sits exactly on top of the video */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />

      {status !== 'streaming' && (
        <div className="absolute inset-0 flex items-center justify-center bg-cyber-darker/80">
          <div className="text-center">
            <svg
              className="w-12 h-12 mx-auto text-cyber-blue/30 mb-2 animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-white/30 text-xs font-inter capitalize">{status}…</p>
          </div>
        </div>
      )}
    </div>
  )
}
