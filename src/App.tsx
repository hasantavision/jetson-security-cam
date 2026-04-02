import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppStore, AppConfig, FamilyMember, EventMessage, MotionZone } from './stores/configStore'
import { onDetectionsUpdate } from './hooks/useWebRTC'
import IdleScreen from './components/IdleScreen'
import EventScreen from './components/EventScreen'
import AdminDashboard from './components/AdminDashboard'
import BackgroundEffects from './components/BackgroundEffects'
import CameraView from './components/CameraView'

function configFromBackend(d: Record<string, unknown>): Partial<AppConfig> {
  const c: Partial<AppConfig> = {}
  if (typeof d.home_number === 'string') c.homeNumber = d.home_number
  if (Array.isArray(d.family_members)) c.familyMembers = d.family_members as FamilyMember[]
  if (Array.isArray(d.event_messages)) c.eventMessages = d.event_messages as EventMessage[]
  if (typeof d.idle_timeout_seconds === 'number') c.idleTimeoutSeconds = d.idle_timeout_seconds
  if (d.zone && typeof d.zone === 'object') c.motionZone = d.zone as MotionZone
  if (typeof d.camera_enabled === 'boolean') c.cameraEnabled = d.camera_enabled
  if (typeof d.avatar_voice_enabled === 'boolean') c.avatarVoiceEnabled = d.avatar_voice_enabled
  if (d.theme === 'blue' || d.theme === 'purple' || d.theme === 'green') c.theme = d.theme
  if (d.event_trigger_mode === 'motion' || d.event_trigger_mode === 'ai') c.eventTriggerMode = d.event_trigger_mode
  if (typeof d.face_track_seconds === 'number') c.faceTrackSeconds = d.face_track_seconds
  return c
}

function configToBackend(c: AppConfig): Record<string, unknown> {
  return {
    home_number: c.homeNumber,
    family_members: c.familyMembers,
    event_messages: c.eventMessages,
    idle_timeout_seconds: c.idleTimeoutSeconds,
    zone: c.motionZone,
    camera_enabled: c.cameraEnabled,
    avatar_voice_enabled: c.avatarVoiceEnabled,
    theme: c.theme,
    event_trigger_mode: c.eventTriggerMode,
    face_track_seconds: c.faceTrackSeconds,
  }
}

function App() {
  const { isEventActive, currentEvent, config, updateConfig, clearEvent, triggerEvent, showAdmin, toggleAdmin } = useAppStore()
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const faceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const faceSeenRef = useRef(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      clearEvent()
    }, config.idleTimeoutSeconds * 1000)
  }, [config.idleTimeoutSeconds, clearEvent])

  // Load all config from backend on startup (backend is source of truth)
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        const loaded = configFromBackend(d)
        if (Object.keys(loaded).length) updateConfig(loaded)
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Save all config to backend on any change (skip until initial load completes)
  useEffect(() => {
    if (!isLoaded) return
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configToBackend(config)),
    }).catch(() => {})
  }, [config, isLoaded])

  // AI face-tracking trigger
  useEffect(() => {
    if (config.eventTriggerMode !== 'ai' || !config.cameraEnabled) return

    const unsub = onDetectionsUpdate((dets) => {
      const facePresent = dets.some(d => d.classid === 1)

      if (facePresent && !faceSeenRef.current) {
        faceSeenRef.current = true
        faceTimerRef.current = setTimeout(() => {
          if (!isEventActive) {
            triggerEvent('person')
            resetIdleTimer()
          }
        }, config.faceTrackSeconds * 1000)
      } else if (!facePresent && faceSeenRef.current) {
        faceSeenRef.current = false
        if (faceTimerRef.current) {
          clearTimeout(faceTimerRef.current)
          faceTimerRef.current = null
        }
      }
    })

    return () => {
      unsub()
      if (faceTimerRef.current) clearTimeout(faceTimerRef.current)
      faceSeenRef.current = false
    }
  }, [config.eventTriggerMode, config.cameraEnabled, config.faceTrackSeconds, isEventActive, triggerEvent, resetIdleTimer])

  // SSE listener for motion events from backend
  useEffect(() => {
    if (!config.cameraEnabled || config.eventTriggerMode !== 'motion') return

    let es: EventSource
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      es = new EventSource('/api/events')
      eventSourceRef.current = es

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.event) {
            triggerEvent(data.event)
            resetIdleTimer()
          }
        } catch {}
      }

      // Reconnect with full handler setup preserved
      es.onerror = () => {
        es.close()
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      es?.close()
    }
  }, [config.cameraEnabled, config.eventTriggerMode, triggerEvent, resetIdleTimer])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        toggleAdmin()
      }
      // D = simulate motion event
      if (e.key === 'd' && !showAdmin) {
        triggerEvent('motion')
        resetIdleTimer()
      }
      // Escape = back to idle
      if (e.key === 'Escape') {
        if (showAdmin) toggleAdmin()
        else if (isEventActive) clearEvent()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleAdmin, triggerEvent, resetIdleTimer, showAdmin, isEventActive, clearEvent])

  return (
    <div className="relative w-full h-full overflow-hidden bg-cyber-darker grid-bg">
      {/* Hidden camera — keeps WebRTC pipeline + motion detection alive at all times */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        <CameraView />
      </div>

      <BackgroundEffects />

      {/* Main content */}
      {isLoaded && (
        <div className="relative z-10 w-full h-full">
          {showAdmin ? (
            <AdminDashboard />
          ) : isEventActive ? (
            <EventScreen eventType={currentEvent || 'motion'} />
          ) : (
            <IdleScreen />
          )}
        </div>
      )}

      {/* Admin toggle hint */}
      {isLoaded && !showAdmin && (
        <div className="absolute bottom-3 right-3 z-20 text-[10px] text-white/10 font-inter select-none">
          Ctrl+Shift+A
        </div>
      )}
    </div>
  )
}

export default App
