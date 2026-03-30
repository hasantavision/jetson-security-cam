import { useEffect, useState } from 'react'

interface Props {
  speaking: boolean
}

export default function Avatar3D({ speaking }: Props) {
  const [blinking, setBlinking] = useState(false)

  // Blink every few seconds
  useEffect(() => {
    const blink = () => {
      setBlinking(true)
      setTimeout(() => setBlinking(false), 150)
    }
    const id = setInterval(blink, 3500 + Math.random() * 2000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-cyber-blue/5 via-transparent to-cyber-purple/5" />

      {/* Orbiting ring */}
      <div className="absolute w-[140px] h-[140px] rounded-full border border-cyber-blue/10 animate-[spin_20s_linear_infinite]">
        <div className="absolute -top-1 left-1/2 w-2 h-2 rounded-full bg-cyber-blue/40" />
      </div>
      <div className="absolute w-[160px] h-[160px] rounded-full border border-cyber-purple/5 animate-[spin_30s_linear_infinite_reverse]">
        <div className="absolute -bottom-0.5 right-4 w-1.5 h-1.5 rounded-full bg-cyber-purple/30" />
      </div>

      {/* Avatar face */}
      <div className="relative animate-float">
        {/* Head */}
        <div className="w-[80px] h-[90px] rounded-[40px_40px_35px_35px] bg-gradient-to-b from-[#0d1f3c] to-[#081428]
          border border-cyber-blue/15 relative shadow-[0_0_30px_rgba(0,212,255,0.08)]">

          {/* Visor / face plate */}
          <div className="absolute top-[18px] left-[10px] right-[10px] h-[32px] rounded-[16px]
            bg-gradient-to-b from-[#0a1a30] to-[#060f20] border border-cyber-blue/10">

            {/* Eyes */}
            <div className="absolute top-[10px] left-[10px] flex gap-[18px]">
              <div className={`w-[12px] rounded-sm bg-cyber-blue shadow-[0_0_8px_rgba(0,212,255,0.6)] transition-all duration-75 ${
                blinking ? 'h-[1px]' : 'h-[5px]'
              }`} />
              <div className={`w-[12px] rounded-sm bg-cyber-blue shadow-[0_0_8px_rgba(0,212,255,0.6)] transition-all duration-75 ${
                blinking ? 'h-[1px]' : 'h-[5px]'
              }`} />
            </div>
          </div>

          {/* Mouth */}
          <div className="absolute bottom-[16px] left-1/2 -translate-x-1/2">
            {speaking ? (
              <div className="flex items-end gap-[2px] h-[8px]">
                <div className="w-[3px] bg-cyber-purple/80 rounded-full animate-pulse" style={{ height: '4px', animationDelay: '0s' }} />
                <div className="w-[3px] bg-cyber-purple/80 rounded-full animate-pulse" style={{ height: '7px', animationDelay: '0.1s' }} />
                <div className="w-[3px] bg-cyber-purple/80 rounded-full animate-pulse" style={{ height: '5px', animationDelay: '0.2s' }} />
                <div className="w-[3px] bg-cyber-purple/80 rounded-full animate-pulse" style={{ height: '8px', animationDelay: '0.15s' }} />
                <div className="w-[3px] bg-cyber-purple/80 rounded-full animate-pulse" style={{ height: '3px', animationDelay: '0.25s' }} />
              </div>
            ) : (
              <div className="w-[20px] h-[2px] rounded-full bg-cyber-purple/40" />
            )}
          </div>

          {/* Side accents */}
          <div className="absolute top-[26px] -left-[3px] w-[3px] h-[10px] rounded-full bg-cyber-blue/30" />
          <div className="absolute top-[26px] -right-[3px] w-[3px] h-[10px] rounded-full bg-cyber-blue/30" />
        </div>

        {/* Neck */}
        <div className="w-[20px] h-[8px] mx-auto bg-gradient-to-b from-[#0d1f3c] to-[#081428]
          border-x border-b border-cyber-blue/10 rounded-b" />

        {/* Shoulders */}
        <div className="w-[100px] h-[14px] mx-auto -mt-[1px] rounded-t-[8px]
          bg-gradient-to-b from-[#0d1f3c] to-[#081020] border border-b-0 border-cyber-blue/10">
          <div className="absolute top-[2px] left-[12px] right-[12px] h-[1px] bg-cyber-blue/15" />
        </div>
      </div>

      {/* Label */}
      <div className="absolute bottom-2 left-0 right-0 text-center">
        <span className="text-[9px] font-orbitron text-cyber-blue/30 tracking-[0.2em] uppercase">
          {speaking ? 'Speaking' : 'Standby'}
        </span>
      </div>
    </div>
  )
}
