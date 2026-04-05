interface ResourceDotsProps {
  current: number;
  max: number;
  filledColor?: string;
  emptyColor?: string;
  size?: 'sm' | 'md';
}

export default function ResourceDots({
  current,
  max,
  filledColor = 'text-brass',
  emptyColor = 'text-ghost/30',
  size = 'sm',
}: ResourceDotsProps) {
  const dotSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <span className={`${dotSize} tracking-wider`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < current ? filledColor : emptyColor}>
          ●
        </span>
      ))}
    </span>
  );
}
