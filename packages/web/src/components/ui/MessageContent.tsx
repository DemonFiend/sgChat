import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isImageUrl, getImageType, extractImageUrls } from '@/lib/imageUtils';

const GIF_AUTOPLAY_DURATION = 6000;

export interface MessageContentProps {
  content: string;
  isOwnMessage?: boolean;
  compact?: boolean;
}

interface ParsedContent {
  type: 'text' | 'image';
  value: string;
}

export function MessageContent({ content, isOwnMessage, compact }: MessageContentProps) {
  const parsedContent = useMemo((): ParsedContent[] => {
    if (!content) return [];

    if (isImageUrl(content)) {
      return [{ type: 'image', value: content }];
    }

    const imageUrls = extractImageUrls(content);
    if (imageUrls.length === 0) {
      return [{ type: 'text', value: content }];
    }

    const segments: ParsedContent[] = [];
    let remaining = content;

    for (const url of imageUrls) {
      const urlIndex = remaining.indexOf(url);
      if (urlIndex > 0) {
        const textBefore = remaining.substring(0, urlIndex).trim();
        if (textBefore) segments.push({ type: 'text', value: textBefore });
      }
      segments.push({ type: 'image', value: url });
      remaining = remaining.substring(urlIndex + url.length);
    }

    const trimmedRemaining = remaining.trim();
    if (trimmedRemaining) segments.push({ type: 'text', value: trimmedRemaining });

    return segments;
  }, [content]);

  return (
    <div className="message-content">
      {parsedContent.map((segment, i) =>
        segment.type === 'image' ? (
          <ImageRenderer key={i} src={segment.value} isOwnMessage={isOwnMessage} compact={compact} />
        ) : (
          <span key={i} className="break-words whitespace-pre-wrap">{segment.value}</span>
        )
      )}
    </div>
  );
}

function getImageClasses(compact?: boolean, isOwnMessage?: boolean): string {
  if (compact) return 'max-w-[200px] max-h-[150px] rounded-lg';
  if (isOwnMessage !== undefined) return 'max-w-[300px] max-h-[250px] rounded-2xl';
  return 'max-w-[400px] max-h-[300px] rounded-lg';
}

function getContainerClasses(compact?: boolean): string {
  return compact ? 'relative inline-block' : 'relative my-1';
}

function ImageErrorFallback({ src, isGif, compact }: { src: string; isGif: boolean; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border text-text-muted ${compact ? 'text-xs' : 'text-sm'}`}>
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-text-muted">
          {isGif ? 'Unable to load GIF' : 'Unable to load image'}
        </span>
        <a href={src} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline truncate text-xs">
          {src}
        </a>
      </div>
    </div>
  );
}

function GifRenderer({ src, isOwnMessage, compact }: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [staticFrame, setStaticFrame] = useState<string | null>(null);

  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const imageClasses = getImageClasses(compact, isOwnMessage);
  const containerClasses = getContainerClasses(compact);

  const captureFrame = useCallback(() => {
    if (!imgRef.current || !canvasRef.current || !imageLoaded) return;
    try {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      canvasRef.current.width = imgRef.current.naturalWidth;
      canvasRef.current.height = imgRef.current.naturalHeight;
      ctx.drawImage(imgRef.current, 0, 0);
      setStaticFrame(canvasRef.current.toDataURL('image/png'));
    } catch {
      setStaticFrame('cors-blocked');
    }
  }, [imageLoaded]);

  const startAutoplayTimer = useCallback(() => {
    if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    autoplayTimerRef.current = setTimeout(() => {
      captureFrame();
      setIsPlaying(false);
    }, GIF_AUTOPLAY_DURATION);
  }, [captureFrame]);

  const handleLoad = useCallback(() => {
    setImageLoaded(true);
    setImageError(false);
    startAutoplayTimer();
  }, [startAutoplayTimer]);

  const handleError = useCallback(() => {
    setImageLoaded(false);
    setImageError(true);
    if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
  }, []);

  const handleClick = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    setStaticFrame(null);
    if (imgRef.current) {
      const s = imgRef.current.src;
      imgRef.current.src = '';
      imgRef.current.src = s;
    }
    startAutoplayTimer();
  }, [isPlaying, startAutoplayTimer]);

  // Reset on src change
  useEffect(() => {
    setIsPlaying(true);
    setImageLoaded(false);
    setImageError(false);
    setStaticFrame(null);
    if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
  }, [src]);

  useEffect(() => {
    return () => {
      if (autoplayTimerRef.current) clearTimeout(autoplayTimerRef.current);
    };
  }, []);

  return (
    <div className={containerClasses}>
      <canvas ref={canvasRef} className="hidden" />

      {!imageLoaded && !imageError && (
        <div
          className={`${imageClasses} bg-bg-tertiary animate-pulse`}
          style={{ width: compact ? '200px' : '300px', height: compact ? '150px' : '200px' }}
          aria-label="Loading GIF..."
        />
      )}

      {imageError && <ImageErrorFallback src={src} isGif compact={compact} />}

      {!imageError && (
        <div
          className={`relative cursor-pointer group ${imageLoaded ? 'block' : 'hidden'}`}
          onClick={handleClick}
        >
          <img
            ref={imgRef}
            src={src}
            alt="GIF animation"
            className={`${imageClasses} object-contain bg-bg-tertiary ${!isPlaying && staticFrame && staticFrame !== 'cors-blocked' ? 'hidden' : ''}`}
            loading="lazy"
            onLoad={handleLoad}
            onError={handleError}
          />

          {!isPlaying && staticFrame && staticFrame !== 'cors-blocked' && (
            <img src={staticFrame} alt="GIF (paused)" className={`${imageClasses} object-contain bg-bg-tertiary`} />
          )}

          {!isPlaying && imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg transition-opacity group-hover:bg-black/40">
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                <svg className="w-6 h-6 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}

          {imageLoaded && (
            <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-bold text-white uppercase">
              GIF
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StaticImageRenderer({ src, isOwnMessage, compact }: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageClasses = getImageClasses(compact, isOwnMessage);
  const containerClasses = getContainerClasses(compact);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [src]);

  return (
    <div className={containerClasses}>
      {!imageLoaded && !imageError && (
        <div
          className={`${imageClasses} bg-bg-tertiary animate-pulse`}
          style={{ width: compact ? '200px' : '300px', height: compact ? '150px' : '200px' }}
          aria-label="Loading image..."
        />
      )}

      {!imageError && (
        <img
          src={src}
          alt="Shared image"
          className={`${imageClasses} object-contain bg-bg-tertiary ${imageLoaded ? 'opacity-100' : 'opacity-0 absolute'}`}
          style={{ transition: 'opacity 0.2s ease-in', display: imageLoaded ? 'block' : 'none' }}
          loading="lazy"
          onLoad={() => { setImageLoaded(true); setImageError(false); }}
          onError={() => { setImageLoaded(false); setImageError(true); }}
        />
      )}

      {imageError && <ImageErrorFallback src={src} isGif={false} compact={compact} />}
    </div>
  );
}

function ImageRenderer({ src, isOwnMessage, compact }: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
  const imageType = getImageType(src);
  if (imageType === 'gif') {
    return <GifRenderer src={src} isOwnMessage={isOwnMessage} compact={compact} />;
  }
  return <StaticImageRenderer src={src} isOwnMessage={isOwnMessage} compact={compact} />;
}
