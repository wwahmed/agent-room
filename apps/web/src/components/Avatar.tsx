interface AvatarProps {
  initials: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  ring?: boolean;
}

const SIZES = {
  sm: 'w-5 h-5 text-[9px]',
  md: 'w-6 h-6 text-[10px]',
  lg: 'w-8 h-8 text-xs',
};

export function Avatar({ initials, color, size = 'md', ring }: AvatarProps) {
  return (
    <div
      className={`${SIZES[size]} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 ${ring ? 'ring-2 ring-white ring-offset-2 ring-offset-accent' : ''}`}
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}
