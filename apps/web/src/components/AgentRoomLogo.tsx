interface AgentRoomLogoProps {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  showWordmark?: boolean;
}

export function AgentRoomLogo({
  className = '',
  markClassName = 'h-9 w-9',
  wordmarkClassName = 'text-lg',
  showWordmark = true,
}: AgentRoomLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`} aria-label="Agent Room">
      <svg className={markClassName} viewBox="0 0 256 256" fill="none" role="img" aria-hidden="true">
        <rect x="16" y="16" width="224" height="224" rx="56" fill="#111318" />
        <circle cx="82" cy="82" r="35" fill="#3B82F6" />
        <circle cx="174" cy="82" r="35" fill="#8B5CF6" />
        <circle cx="82" cy="174" r="35" fill="#10B981" />
        <circle cx="174" cy="174" r="35" fill="#F59E0B" />
        <circle cx="128" cy="128" r="28" fill="#FFFFFF" />
      </svg>
      {showWordmark && (
        <span className={`${wordmarkClassName} font-bold tracking-tight text-ink`}>
          <span className="mr-1 text-ink-faint">[</span>
          Agent Room
          <span className="ml-1 text-ink-faint">]</span>
        </span>
      )}
    </div>
  );
}
