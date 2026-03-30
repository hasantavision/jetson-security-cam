import { useState, useCallback, useEffect } from 'react'
import { useAppStore, FamilyMember, EventMessage } from '../stores/configStore'
import CameraView from './CameraView'

export default function AdminDashboard() {
  const { config, updateConfig, toggleAdmin } = useAppStore()
  const [activeTab, setActiveTab] = useState<'general' | 'events' | 'camera'>('general')
  const [focusValue, setFocusValue] = useState(500)
  const [focusBusy, setFocusBusy] = useState(false)

  // Load current focus from server on mount
  useEffect(() => {
    fetch('/api/focus')
      .then(r => r.json())
      .then(d => { if (d.focus != null) setFocusValue(d.focus) })
      .catch(() => {})
  }, [])

  const sendFocus = useCallback((val: number) => {
    setFocusValue(val)
    fetch('/api/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focus: val }),
    }).catch(() => {})
  }, [])

  const runAutofocus = useCallback(() => {
    setFocusBusy(true)
    fetch('/api/autofocus', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.focus != null) setFocusValue(d.focus) })
      .catch(() => {})
      .finally(() => setFocusBusy(false))
  }, [])

  const tabs = [
    { id: 'general' as const, label: 'General' },
    { id: 'events' as const, label: 'Events' },
    { id: 'camera' as const, label: 'Camera' },
  ]

  const addFamilyMember = () => {
    const members = [...config.familyMembers, { id: Date.now().toString(), name: 'New Member' }]
    updateConfig({ familyMembers: members })
  }

  const removeFamilyMember = (id: string) => {
    updateConfig({ familyMembers: config.familyMembers.filter((m) => m.id !== id) })
  }

  const updateMember = (id: string, name: string) => {
    updateConfig({
      familyMembers: config.familyMembers.map((m) => (m.id === id ? { ...m, name } : m)),
    })
  }

  const addEventMessage = () => {
    updateConfig({
      eventMessages: [...config.eventMessages, { trigger: 'custom', message: 'New event message' }],
    })
  }

  const removeEventMessage = (index: number) => {
    updateConfig({ eventMessages: config.eventMessages.filter((_, i) => i !== index) })
  }

  const updateEventMessage = (index: number, field: keyof EventMessage, value: string) => {
    updateConfig({
      eventMessages: config.eventMessages.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    })
  }

  return (
    <div className="w-full h-full flex items-center justify-center animate-fade-in p-6">
      <div className="w-full max-w-3xl max-h-[90vh] rounded-3xl glow-border bg-cyber-panel backdrop-blur-xl
        flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/5">
          <div>
            <h1 className="text-lg font-orbitron font-bold tracking-wider text-white/90">Admin Dashboard</h1>
            <p className="text-xs font-inter text-white/30 mt-1">Configure your Smart Guard system</p>
          </div>
          <button onClick={toggleAdmin}
            className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
              flex items-center justify-center transition-all group">
            <svg className="w-5 h-5 text-white/40 group-hover:text-white/70 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-8 pt-4">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 rounded-xl text-xs font-orbitron font-medium tracking-wider transition-all
                ${activeTab === tab.id
                  ? 'bg-cyber-blue/15 text-cyber-blue border border-cyber-blue/20'
                  : 'text-white/30 hover:text-white/50 border border-transparent'
                }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6">

          {activeTab === 'general' && (
            <>
              {/* Home Number */}
              <FieldGroup label="Home Number">
                <input
                  value={config.homeNumber}
                  onChange={(e) => updateConfig({ homeNumber: e.target.value })}
                  className="input-field w-32 text-2xl font-orbitron font-bold text-center"
                  maxLength={6}
                />
              </FieldGroup>

              {/* Family Members */}
              <FieldGroup label="Family Members">
                <div className="space-y-2">
                  {config.familyMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3">
                      <input
                        value={member.name}
                        onChange={(e) => updateMember(member.id, e.target.value)}
                        className="input-field flex-1"
                      />
                      <button onClick={() => removeFamilyMember(member.id)}
                        className="btn-icon text-red-400/50 hover:text-red-400">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button onClick={addFamilyMember} className="btn-add">+ Add Member</button>
                </div>
              </FieldGroup>

              {/* Theme */}
              <FieldGroup label="Accent Theme">
                <div className="flex gap-3">
                  {(['blue', 'purple', 'green'] as const).map((t) => (
                    <button key={t} onClick={() => updateConfig({ theme: t })}
                      className={`w-10 h-10 rounded-xl border-2 transition-all ${
                        config.theme === t ? 'border-white/50 scale-110' : 'border-white/10'
                      }`}
                      style={{
                        background: t === 'blue' ? '#00d4ff' : t === 'purple' ? '#8b5cf6' : '#10b981',
                        opacity: config.theme === t ? 1 : 0.4,
                      }}
                    />
                  ))}
                </div>
              </FieldGroup>

              {/* Idle Timeout */}
              <FieldGroup label="Idle Timeout (seconds)">
                <input
                  type="number"
                  value={config.idleTimeoutSeconds}
                  onChange={(e) => updateConfig({ idleTimeoutSeconds: parseInt(e.target.value) || 30 })}
                  className="input-field w-32"
                  min={5}
                  max={300}
                />
              </FieldGroup>
            </>
          )}

          {activeTab === 'events' && (
            <>
              {/* Trigger Mode */}
              <FieldGroup label="Event Trigger Mode">
                <p className="text-xs text-white/20 font-inter mb-3">
                  Choose what causes the alert layout to activate.
                </p>
                <div className="flex gap-3 mb-4">
                  {(['motion', 'ai'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateConfig({ eventTriggerMode: mode })}
                      className={`flex-1 py-3 rounded-xl text-xs font-orbitron font-semibold tracking-wider border transition-all ${
                        config.eventTriggerMode === mode
                          ? 'bg-cyber-blue/15 border-cyber-blue/30 text-cyber-blue'
                          : 'border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'
                      }`}
                    >
                      {mode === 'motion' ? 'Motion' : 'AI Face Track'}
                    </button>
                  ))}
                </div>
                {config.eventTriggerMode === 'ai' && (
                  <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4">
                    <p className="text-[10px] font-inter text-white/30 mb-3">
                      Triggers when a face is continuously detected for the set duration.
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="text-[10px] font-orbitron text-white/40 tracking-wider w-32">
                        DWELL (seconds)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={config.faceTrackSeconds}
                        onChange={(e) => updateConfig({ faceTrackSeconds: parseInt(e.target.value) || 3 })}
                        className="input-field w-24"
                      />
                    </div>
                  </div>
                )}
                {config.eventTriggerMode === 'motion' && (
                  <p className="text-[10px] font-inter text-white/20">
                    Events are pushed from the backend via SSE when motion is detected.
                  </p>
                )}
              </FieldGroup>

              <FieldGroup label="Event Messages">
                <p className="text-xs text-white/20 font-inter mb-4">
                  Define what the avatar says for each event type.
                </p>
                <div className="space-y-4">
                  {config.eventMessages.map((msg, i) => (
                    <div key={i} className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <label className="text-[10px] font-orbitron text-white/30 tracking-wider w-16">TRIGGER</label>
                        <input
                          value={msg.trigger}
                          onChange={(e) => updateEventMessage(i, 'trigger', e.target.value)}
                          className="input-field flex-1"
                        />
                        <button onClick={() => removeEventMessage(i)}
                          className="btn-icon text-red-400/50 hover:text-red-400">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex items-start gap-3">
                        <label className="text-[10px] font-orbitron text-white/30 tracking-wider w-16 pt-2">MESSAGE</label>
                        <textarea
                          value={msg.message}
                          onChange={(e) => updateEventMessage(i, 'message', e.target.value)}
                          className="input-field flex-1 min-h-[60px] resize-none"
                          rows={2}
                        />
                      </div>
                    </div>
                  ))}
                  <button onClick={addEventMessage} className="btn-add">+ Add Event</button>
                </div>
              </FieldGroup>

              {/* Avatar Voice */}
              <FieldGroup label="Avatar Voice">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-12 h-6 rounded-full transition-colors relative ${
                    config.avatarVoiceEnabled ? 'bg-cyber-blue/40' : 'bg-white/10'
                  }`}
                    onClick={() => updateConfig({ avatarVoiceEnabled: !config.avatarVoiceEnabled })}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                      config.avatarVoiceEnabled ? 'left-[26px]' : 'left-0.5'
                    }`} />
                  </div>
                  <span className="text-sm font-inter text-white/50">
                    {config.avatarVoiceEnabled ? 'TTS Enabled' : 'TTS Disabled'}
                  </span>
                </label>
              </FieldGroup>
            </>
          )}

          {activeTab === 'camera' && (
            <>
              {/* Camera Toggle */}
              <FieldGroup label="Camera Feed">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className={`w-12 h-6 rounded-full transition-colors relative ${
                    config.cameraEnabled ? 'bg-emerald-500/40' : 'bg-white/10'
                  }`}
                    onClick={() => updateConfig({ cameraEnabled: !config.cameraEnabled })}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                      config.cameraEnabled ? 'left-[26px]' : 'left-0.5'
                    }`} />
                  </div>
                  <span className="text-sm font-inter text-white/50">
                    {config.cameraEnabled ? 'Camera Active' : 'Camera Disabled'}
                  </span>
                </label>
              </FieldGroup>

              {/* Motion Zone */}
              <FieldGroup label="Motion Detection Zone">
                <p className="text-xs text-white/20 font-inter mb-3">
                  Normalized coordinates (0.0 – 1.0) of the detection region.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(['x', 'y', 'width', 'height'] as const).map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <label className="text-[10px] font-orbitron text-white/30 tracking-wider uppercase w-12">{key}</label>
                      <input
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        value={config.motionZone[key]}
                        onChange={(e) =>
                          updateConfig({
                            motionZone: { ...config.motionZone, [key]: parseFloat(e.target.value) || 0 },
                          })
                        }
                        className="input-field flex-1"
                      />
                    </div>
                  ))}
                </div>
              </FieldGroup>

              {/* Focus Control */}
              <FieldGroup label="Focus Control">
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={0}
                      max={1000}
                      step={10}
                      value={focusValue}
                      onChange={(e) => sendFocus(parseInt(e.target.value))}
                      className="flex-1 h-2 rounded-full appearance-none bg-white/10
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyber-blue
                        [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,212,255,0.5)] [&::-webkit-slider-thumb]:cursor-pointer"
                    />
                    <span className="text-sm font-mono text-white/50 w-12 text-right">{focusValue}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={runAutofocus} disabled={focusBusy}
                      className={`px-4 py-2 rounded-xl text-xs font-orbitron font-medium tracking-wider
                        border transition-all ${focusBusy
                          ? 'border-white/5 text-white/20 cursor-wait'
                          : 'border-cyber-blue/20 text-cyber-blue/70 hover:bg-cyber-blue/10'
                        }`}>
                      {focusBusy ? 'Focusing...' : 'Autofocus'}
                    </button>
                    {[0, 250, 500, 750, 1000].map(v => (
                      <button key={v} onClick={() => sendFocus(v)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-all border ${
                          focusValue === v
                            ? 'border-cyber-blue/30 text-cyber-blue/70 bg-cyber-blue/5'
                            : 'border-white/5 text-white/25 hover:text-white/50'
                        }`}>
                        {v}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/15 font-inter">
                    0 = infinity · 1000 = macro · Requires I2C focuser on bus 7
                  </p>
                </div>
              </FieldGroup>

              {/* Camera preview */}
              <FieldGroup label="Preview">
                <div className="w-full aspect-video rounded-xl overflow-hidden bg-cyber-darker border border-white/5">
                  <CameraView />
                </div>
              </FieldGroup>
            </>
          )}
        </div>
      </div>

    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-orbitron font-semibold text-white/40 tracking-wider uppercase mb-3">
        {label}
      </label>
      {children}
    </div>
  )
}
