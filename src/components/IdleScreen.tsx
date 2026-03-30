import { useAppStore } from '../stores/configStore'
import StatusBar from './StatusBar'

export default function IdleScreen() {
  const { config } = useAppStore()

  return (
    <div className="w-full h-full flex flex-col items-center justify-center animate-fade-in">
      <StatusBar />

      {/* Main home number display — sized for 7" 1024x600 readable at 5m */}
      <div className="relative flex flex-col items-center">
        {/* Arc decorations */}
        <svg className="absolute w-[500px] h-[500px] -z-0 opacity-60" viewBox="0 0 400 400">
          <defs>
            <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <circle cx="200" cy="200" r="155" fill="none" stroke="url(#arcGrad)" strokeWidth="1"
            strokeDasharray="40 20 80 30" className="animate-[spin_30s_linear_infinite]" />
          <circle cx="200" cy="200" r="175" fill="none" stroke="#00d4ff" strokeWidth="0.5"
            strokeDasharray="10 50 30 40" strokeOpacity="0.2"
            className="animate-[spin_45s_linear_infinite_reverse]" />
        </svg>

        {/* Home number — massive for 5m readability */}
        <div className="relative z-10 flex flex-col items-center">
          <div
            className="leading-none font-orbitron font-black tracking-wider
              bg-gradient-to-b from-white via-cyber-blue to-cyber-purple bg-clip-text text-transparent
              drop-shadow-[0_0_80px_rgba(0,212,255,0.4)]"
            style={{ fontSize: 'min(340px, 55vh)' }}
          >
            {config.homeNumber}
          </div>

          {/* Underline accent */}
          <div className="w-64 h-[2px] bg-gradient-to-r from-transparent via-cyber-blue/60 to-transparent" />

          {/* Family members — parents row */}
          <div className="mt-2 flex flex-wrap justify-center gap-x-8">
            {config.familyMembers.slice(0, 2).map((member, i) => (
              <div key={member.id} className="flex items-center gap-2 animate-slide-up"
                style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                <div className="w-2 h-2 rounded-full bg-cyber-blue/60 animate-pulse-glow" />
                <span
                  className="font-rajdhani font-semibold text-white/70 tracking-[0.12em] uppercase"
                  style={{ fontSize: 'min(36px, 6vh)' }}
                >
                  {member.name}
                </span>
              </div>
            ))}
          </div>
          {/* Kids row */}
          {config.familyMembers.length > 2 && (
            <div className="mt-1 flex flex-wrap justify-center gap-x-8">
              {config.familyMembers.slice(2).map((member, i) => (
                <div key={member.id} className="flex items-center gap-2 animate-slide-up"
                  style={{ animationDelay: `${0.5 + i * 0.15}s` }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-cyber-purple/60 animate-pulse-glow" />
                  <span
                    className="font-rajdhani font-medium text-white/50 tracking-[0.12em] uppercase"
                    style={{ fontSize: 'min(28px, 4.5vh)' }}
                  >
                    {member.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom decorative bar */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-cyber-blue/30" />
        <div className="w-1 h-1 rounded-full bg-cyber-blue/40" />
        <span className="text-[9px] font-inter text-white/15 tracking-[0.3em] uppercase">Secure</span>
        <div className="w-1 h-1 rounded-full bg-emerald-500/40" />
        <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-cyber-blue/30" />
      </div>
    </div>
  )
}
