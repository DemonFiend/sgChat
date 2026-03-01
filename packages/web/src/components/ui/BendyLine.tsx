interface BendyLineProps {
  variant?: 'horizontal' | 'vertical';
  direction?: 'down' | 'up';
  className?: string;
}

/**
 * Organic bendy line component using SVG paths
 * Creates a hand-drawn aesthetic divider
 */
export function BendyLine({ variant = 'horizontal', direction = 'down', className }: BendyLineProps) {
  if (variant === 'horizontal') {
    const path = direction === 'down'
      ? 'M 0,2 Q 15,0 30,3 T 60,2 T 90,4 T 100,2'
      : 'M 0,4 Q 15,6 30,3 T 60,4 T 90,2 T 100,4';

    return (
      <svg
        viewBox="0 0 100 6"
        preserveAspectRatio="none"
        className={`w-full h-3 ${className || ''}`}
      >
        <path
          d={path}
          stroke="var(--color-border)"
          strokeWidth="1.5"
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const path = direction === 'down'
    ? 'M 2,0 Q 0,15 3,30 T 2,60 T 4,90 T 2,100'
    : 'M 4,0 Q 6,15 3,30 T 4,60 T 2,90 T 4,100';

  return (
    <svg
      viewBox="0 0 6 100"
      preserveAspectRatio="none"
      className={`h-full w-3 ${className || ''}`}
    >
      <path
        d={path}
        stroke="var(--color-border)"
        strokeWidth="1.5"
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    </svg>
  );
}
