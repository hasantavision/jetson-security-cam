import { useCallback, useEffect, useState } from 'react'
import { Detection } from './useWebRTC'

// BGR → CSS colour per class (matches yolox_trt.py CLASS_COLORS)
const CLASS_CSS: Record<number, string> = {
  0: '#ff8c28',   // body  — amber
  1: '#2878ff',   // head  — blue
  2: '#28c850',   // hand  — green
}

const CLASS_LABEL: Record<number, string> = {
  0: 'body', 1: 'head', 2: 'hand',
}

/**
 * Keeps a canvas overlay sized to its paired video element and redraws
 * YOLOX detection bounding boxes whenever `detections` or canvas dimensions change.
 *
 * Both `CameraView` and `EventScreen` render a video + canvas overlay pair —
 * this hook centralises all drawing logic to avoid duplication.
 */
export function useDetectionCanvas(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  detections: Detection[],
): void {
  // Bumped whenever the canvas buffer is resized so the draw effect re-runs
  // and repaints the current detections onto the freshly-sized surface.
  const [canvasVersion, setCanvasVersion] = useState(0)

  // Match canvas pixel dimensions to the rendered video element dimensions.
  const syncCanvasSize = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const { offsetWidth: w, offsetHeight: h } = video
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w
      canvas.height = h
      setCanvasVersion(v => v + 1)
    }
  }, [videoRef, canvasRef])

  // Redraw boxes whenever detections change or the canvas is resized.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    syncCanvasSize()

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width: cw, height: ch } = canvas
    ctx.clearRect(0, 0, cw, ch)
    if (!detections.length) return

    const fontSize   = Math.max(11, Math.round(cw * 0.022))
    ctx.font         = `bold ${fontSize}px Inter, sans-serif`
    ctx.textBaseline = 'bottom'

    for (const d of detections) {
      const x   = d.x1 * cw
      const y   = d.y1 * ch
      const bw  = (d.x2 - d.x1) * cw
      const bh  = (d.y2 - d.y1) * ch
      const col = CLASS_CSS[d.classid] ?? '#ffffff'

      // White outer stroke ensures readability on any background colour.
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth   = 3
      ctx.strokeRect(x, y, bw, bh)

      // Coloured inner stroke conveys class identity at a glance.
      ctx.strokeStyle = col
      ctx.lineWidth   = 1.5
      ctx.strokeRect(x, y, bw, bh)

      // Label with semi-opaque class-coloured background.
      const label = `${CLASS_LABEL[d.classid] ?? d.label}  ${(d.score * 100).toFixed(0)}%`
      const tw    = ctx.measureText(label).width
      const th    = fontSize + 4
      const lx    = Math.min(x, cw - tw - 6)
      // Place label above box when there is room; otherwise place it below.
      const ly    = y > th + 2 ? y - th - 2 : y + bh + 2

      ctx.fillStyle = `${col}cc`   // 80 % opaque
      ctx.fillRect(lx, ly, tw + 8, th)
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, lx + 4, ly + th - 2)
    }
  }, [detections, syncCanvasSize, canvasVersion, canvasRef])

  // Keep canvas sized to video on layout changes (font scale, orientation, etc.).
  useEffect(() => {
    const obs = new ResizeObserver(syncCanvasSize)
    if (videoRef.current) obs.observe(videoRef.current)
    return () => obs.disconnect()
  }, [syncCanvasSize, videoRef])
}
