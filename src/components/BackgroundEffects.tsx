export default function BackgroundEffects() {
  return (
    <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Radial gradient center glow */}
      <div className="absolute inset-0 radial-pulse" />

      {/* Decorative curved lines */}
      <div className="curve-line w-[600px] h-[600px] -top-[200px] -right-[200px] opacity-30" />
      <div className="curve-line w-[800px] h-[800px] -bottom-[300px] -left-[300px] opacity-20" />
      <div className="curve-line w-[400px] h-[400px] top-[20%] left-[60%] opacity-10" />

      {/* Floating orbs */}
      <div className="absolute w-32 h-32 rounded-full bg-cyber-blue/5 blur-3xl top-[15%] left-[10%] animate-float" />
      <div className="absolute w-48 h-48 rounded-full bg-cyber-purple/5 blur-3xl top-[60%] right-[15%] animate-float" style={{ animationDelay: '2s' }} />
      <div className="absolute w-24 h-24 rounded-full bg-cyber-pink/5 blur-3xl bottom-[20%] left-[40%] animate-float" style={{ animationDelay: '4s' }} />

      {/* Scan line */}
      <div className="scan-line" />

      {/* Corner accents */}
      <svg className="absolute top-4 left-4 w-16 h-16 opacity-20" viewBox="0 0 64 64">
        <path d="M0 20 L0 0 L20 0" fill="none" stroke="#00d4ff" strokeWidth="1.5" />
      </svg>
      <svg className="absolute top-4 right-4 w-16 h-16 opacity-20" viewBox="0 0 64 64">
        <path d="M44 0 L64 0 L64 20" fill="none" stroke="#00d4ff" strokeWidth="1.5" />
      </svg>
      <svg className="absolute bottom-4 left-4 w-16 h-16 opacity-20" viewBox="0 0 64 64">
        <path d="M0 44 L0 64 L20 64" fill="none" stroke="#00d4ff" strokeWidth="1.5" />
      </svg>
      <svg className="absolute bottom-4 right-4 w-16 h-16 opacity-20" viewBox="0 0 64 64">
        <path d="M44 64 L64 64 L64 44" fill="none" stroke="#00d4ff" strokeWidth="1.5" />
      </svg>
    </div>
  )
}
