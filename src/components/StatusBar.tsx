import { useState, useEffect } from 'react'

export default function StatusBar() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  const dateStr = time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-2">
      {/* Left: system name */}
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
        <span className="text-[10px] font-orbitron font-medium tracking-[0.2em] text-white/40 uppercase">
          Smart Guard
        </span>
      </div>

      {/* Center: status */}
      <div className="flex items-center gap-1.5">
        <svg className="w-2.5 h-2.5 text-emerald-400/60" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
        </svg>
        <span className="text-[9px] font-inter text-white/25 tracking-widest uppercase">System Active</span>
      </div>

      {/* Right: clock */}
      <div className="text-right">
        <div className="text-xs font-orbitron font-medium text-white/50 tracking-wider">{timeStr}</div>
        <div className="text-[9px] font-inter text-white/20 tracking-wider uppercase">{dateStr}</div>
      </div>
    </div>
  )
}
