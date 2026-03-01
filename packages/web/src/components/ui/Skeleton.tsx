import { clsx } from 'clsx';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  className?: string;
}

export function Skeleton({ width, height, rounded = 'md', className }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'bg-bg-modifier-hover animate-pulse',
        rounded === 'sm' && 'rounded-sm',
        rounded === 'md' && 'rounded',
        rounded === 'lg' && 'rounded-lg',
        rounded === 'full' && 'rounded-full',
        className
      )}
      style={{ width, height }}
    />
  );
}

export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={12}
          width={i === lines - 1 && lines > 1 ? '60%' : '100%'}
          rounded="sm"
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const px = size === 'sm' ? 24 : size === 'md' ? 32 : size === 'lg' ? 40 : 64;
  return <Skeleton width={px} height={px} rounded="full" />;
}

export function SkeletonMessage() {
  return (
    <div className="flex gap-4 px-4 py-2">
      <SkeletonAvatar size="md" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="flex items-center gap-2">
          <Skeleton width={100} height={14} rounded="sm" />
          <Skeleton width={40} height={10} rounded="sm" />
        </div>
        <SkeletonText lines={2} />
      </div>
    </div>
  );
}
