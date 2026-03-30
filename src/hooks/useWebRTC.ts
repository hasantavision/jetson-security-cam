import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type Status = 'connecting' | 'negotiating' | 'streaming' | 'failed'

export interface Detection {
  classid: number    // 0=body  1=head  2=hand
  label:   string
  score:   number    // 0-1
  x1: number         // normalised 0-1
  y1: number
  x2: number
  y2: number
}

// ── Shared stream ────────────────────────────────────────────────────────────
// One WebRTC connection, multiple video consumers.
let _sharedStream: MediaStream | null = null
const _streamListeners: Set<(s: MediaStream) => void> = new Set()

export function onStreamReady(cb: (s: MediaStream) => void): () => void {
  if (_sharedStream) { cb(_sharedStream); return () => {} }
  _streamListeners.add(cb)
  return () => { _streamListeners.delete(cb) }
}

function _notifyStream(stream: MediaStream) {
  _sharedStream = stream
  _streamListeners.forEach(cb => cb(stream))
  _streamListeners.clear()
}

// ── Shared detections ────────────────────────────────────────────────────────
// Primary Socket.IO connection pushes; all consumers subscribe.
let _sharedDetections: Detection[] = []
const _detectionListeners: Set<(d: Detection[]) => void> = new Set()

export function onDetectionsUpdate(cb: (d: Detection[]) => void): () => void {
  cb(_sharedDetections)
  _detectionListeners.add(cb)
  return () => { _detectionListeners.delete(cb) }
}

function _notifyDetections(dets: Detection[]) {
  _sharedDetections = dets
  _detectionListeners.forEach(cb => cb(dets))
}

// ── Singleton guard ──────────────────────────────────────────────────────────
// Ensures only ONE RTCPeerConnection + Socket.IO connection is ever created,
// even when multiple CameraView instances mount at the same time (e.g. hidden
// always-on instance + admin preview).
let _primaryStarted = false

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useWebRTC(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [status, setStatus]         = useState<Status>('connecting')
  const [detections, setDetections] = useState<Detection[]>(_sharedDetections)
  const pcRef     = useRef<RTCPeerConnection | null>(null)
  const socketRef = useRef<Socket | null>(null)

  // Claim the primary role synchronously during the render phase so that a
  // second instance rendering before any effects fire sees _primaryStarted=true
  // and correctly enters consumer mode.
  const isPrimary = useRef<boolean>(false)
  if (!isPrimary.current && !_primaryStarted) {
    _primaryStarted  = true
    isPrimary.current = true
  }

  useEffect(() => {
    // ── Subscribe to shared detections (all instances) ──────────────────────
    const unsubDets = onDetectionsUpdate(setDetections)

    if (!isPrimary.current) {
      // ── Consumer mode ──────────────────────────────────────────────────────
      // Attach the already-established stream (or wait for it) and subscribe
      // to detections via the shared channel — no extra WebRTC/Socket.IO.
      const unsubStream = onStreamReady((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
          videoRef.current.onplaying = () => setStatus('streaming')
        }
        setStatus('streaming')
      })
      return () => { unsubDets(); unsubStream() }
    }

    // ── Primary mode ─────────────────────────────────────────────────────────
    _primaryStarted = true

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc

    pc.ontrack = (e) => {
      const stream =
        e.streams && e.streams.length > 0
          ? e.streams[0]
          : new MediaStream([e.track])
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      _notifyStream(stream)
      setStatus('negotiating')
    }

    if (videoRef.current) {
      videoRef.current.onplaying = () => setStatus('streaming')
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setStatus('failed')
    }

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'disconnected'
      ) setStatus('failed')
    }

    const socket = io({ transports: ['polling'] })
    socketRef.current = socket

    const STORAGE_KEY = 'smart_home_server_start'
    socket.on('server_start', (data: { t: number }) => {
      const prev = parseFloat(sessionStorage.getItem(STORAGE_KEY) || '0')
      sessionStorage.setItem(STORAGE_KEY, String(data.t))
      if (prev && data.t > prev + 2) window.location.reload()
    })

    socket.on('connect', () => {
      // Delay so server_start arrives first. If the server just restarted the
      // browser will location.reload() inside the server_start handler — the
      // timer is cancelled before it fires, meaning 'start' is never sent by
      // the dying socket.  The reloaded page's fresh connection then sends
      // 'start' without hitting the 2-second debounce window.
      setTimeout(() => { if (socket.connected) socket.emit('start') }, 300)
    })

    socket.on('offer', async (sdp: string) => {
      setStatus('negotiating')
      await pc.setRemoteDescription({ type: 'offer', sdp })
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('answer', answer.sdp)
    })

    socket.on('candidate', (c: RTCIceCandidateInit) => {
      pc.addIceCandidate(c).catch(() => {})
    })

    socket.on('detections', (dets: Detection[]) => {
      _notifyDetections(dets)
    })

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('candidate', e.candidate)
    }

    return () => {
      unsubDets()
      pc.close()
      socket.disconnect()
      // Reset singleton so a fresh primary can start if this one unmounts
      _primaryStarted  = false
      _sharedStream    = null
    }
  }, [videoRef])

  const restart = () => {
    if (socketRef.current?.connected) socketRef.current.emit('start')
  }

  return { status, restart, detections }
}
