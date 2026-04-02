import { create } from 'zustand'

export interface FamilyMember {
  id: string
  name: string
}

export interface EventMessage {
  trigger: string
  message: string
}

export interface MotionZone {
  x: number
  y: number
  width: number
  height: number
}

export interface AppConfig {
  homeNumber: string
  familyMembers: FamilyMember[]
  eventMessages: EventMessage[]
  idleTimeoutSeconds: number
  motionZone: MotionZone
  cameraEnabled: boolean
  avatarVoiceEnabled: boolean
  theme: 'blue' | 'purple' | 'green'
  eventTriggerMode: 'motion' | 'ai'
  faceTrackSeconds: number
}

interface AppState {
  config: AppConfig
  isEventActive: boolean
  currentEvent: string | null
  showAdmin: boolean
  updateConfig: (partial: Partial<AppConfig>) => void
  triggerEvent: (eventType: string) => void
  clearEvent: () => void
  toggleAdmin: () => void
}

const defaultConfig: AppConfig = {
  homeNumber: 'A1',
  familyMembers: [
    { id: '1', name: 'Hasanuddin' },
    { id: '2', name: 'Dwilaras Athina' },
    { id: '3', name: 'Azhar' },
    { id: '4', name: 'Zayn' },
  ],
  eventMessages: [
    { trigger: 'motion', message: 'Motion detected at the front door. Monitoring the area.' },
    { trigger: 'person', message: 'A person has been detected near the entrance. Stay alert.' },
    { trigger: 'package', message: 'It looks like a package has been delivered at the door.' },
    { trigger: 'unknown', message: 'An unrecognized activity has been detected. Please check.' },
  ],
  idleTimeoutSeconds: 30,
  motionZone: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  cameraEnabled: true,
  avatarVoiceEnabled: true,
  theme: 'blue',
  eventTriggerMode: 'motion',
  faceTrackSeconds: 3,
}

export const useAppStore = create<AppState>()(
  (set) => ({
    config: defaultConfig,
    isEventActive: false,
    currentEvent: null,
    showAdmin: false,
    updateConfig: (partial) =>
      set((state) => ({ config: { ...state.config, ...partial } })),
    triggerEvent: (eventType) =>
      set({ isEventActive: true, currentEvent: eventType }),
    clearEvent: () =>
      set({ isEventActive: false, currentEvent: null }),
    toggleAdmin: () =>
      set((state) => ({ showAdmin: !state.showAdmin })),
  })
)
