import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

interface MicLevelMeterProps {
  analyserNode: AnalyserNode | null;
  inputVolume?: number;
  className?: string;
}

export function MicLevelMeter({ analyserNode, inputVolume = 100, className }: MicLevelMeterProps) {
  const [level, setLevel] = useState(0);
  const animationFrameRef = useRef<number | null>(null);
  const inputVolumeRef = useRef(inputVolume);

  useEffect(() => {
    inputVolumeRef.current = inputVolume;
  }, [inputVolume]);

  useEffect(() => {
    if (!analyserNode) {
      setLevel(0);
      return;
    }

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    const update = () => {
      analyserNode.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const normalized = Math.min(100, (average / 128) * 100 * (inputVolumeRef.current / 100));
      setLevel(normalized);
      animationFrameRef.current = requestAnimationFrame(update);
    };

    animationFrameRef.current = requestAnimationFrame(update);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setLevel(0);
    };
  }, [analyserNode]);

  const barColor = level > 80 ? 'bg-error' : level > 50 ? 'bg-warning' : 'bg-success';

  return (
    <div className={clsx('h-2 bg-bg-tertiary rounded-full overflow-hidden', className)}>
      <div
        className={clsx('h-full transition-all duration-75', barColor)}
        style={{ width: `${level}%` }}
      />
    </div>
  );
}
