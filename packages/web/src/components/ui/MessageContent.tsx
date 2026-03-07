import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { isImageUrl, getImageType, extractImageUrls } from '@/lib/imageUtils';
import { parseMentions, parseMessageLinks } from '@sgchat/shared';
import type { ParsedMention, ParsedMessageLink } from '@sgchat/shared';
import {
  UserMentionBadge,
  ChannelMentionBadge,
  RoleMentionBadge,
  BroadcastMentionBadge,
  TimeMentionBadge,
  MOTDBadge,
  MessageLinkEmbed,
} from './MentionBadges';
import { renderCustomEmojis } from '@/lib/emojiRenderer';
import { useEmojiManifestStore } from '@/stores/emojiManifest';

const GIF_AUTOPLAY_DURATION = 6000;

export interface MessageContentProps {
  content: string;
  isOwnMessage?: boolean;
  compact?: boolean;
  serverId?: string;
}

interface ParsedSegment {
  type: 'text' | 'image' | 'mention' | 'messageLink';
  value: string;
  mention?: ParsedMention;
  link?: ParsedMessageLink;
}

/**
 * Parse content into segments: text, images, mentions, and message links.
 * Mentions and message links are parsed from text portions only.
 */
function parseContentSegments(content: string): ParsedSegment[] {
  if (!content) return [];

  // If entire content is a single image URL, render as image only
  if (isImageUrl(content)) {
    return [{ type: 'image', value: content }];
  }

  // First, split by image URLs
  const imageUrls = extractImageUrls(content);
  const rawSegments: { type: 'text' | 'image'; value: string }[] = [];

  if (imageUrls.length === 0) {
    rawSegments.push({ type: 'text', value: content });
  } else {
    let remaining = content;
    for (const url of imageUrls) {
      const urlIndex = remaining.indexOf(url);
      if (urlIndex > 0) {
        const textBefore = remaining.substring(0, urlIndex).trim();
        if (textBefore) rawSegments.push({ type: 'text', value: textBefore });
      }
      rawSegments.push({ type: 'image', value: url });
      remaining = remaining.substring(urlIndex + url.length);
    }
    const trimmedRemaining = remaining.trim();
    if (trimmedRemaining) rawSegments.push({ type: 'text', value: trimmedRemaining });
  }

  // Now, parse mentions and message links from text segments
  const segments: ParsedSegment[] = [];

  for (const seg of rawSegments) {
    if (seg.type === 'image') {
      segments.push({ type: 'image', value: seg.value });
      continue;
    }

    // Collect all mentions and message links in this text
    const mentions = parseMentions(seg.value);
    const links = parseMessageLinks(seg.value);

    // Merge mentions and links into a single sorted array of "tokens"
    const tokens: { start: number; end: number; kind: 'mention' | 'link'; data: any }[] = [];
    for (const m of mentions) {
      tokens.push({ start: m.start, end: m.end, kind: 'mention', data: m });
    }
    for (const l of links) {
      tokens.push({ start: l.start, end: l.end, kind: 'link', data: l });
    }
    tokens.sort((a, b) => a.start - b.start);

    if (tokens.length === 0) {
      segments.push({ type: 'text', value: seg.value });
      continue;
    }

    let cursor = 0;
    for (const token of tokens) {
      // Text before this token
      if (token.start > cursor) {
        segments.push({ type: 'text', value: seg.value.slice(cursor, token.start) });
      }
      if (token.kind === 'mention') {
        segments.push({ type: 'mention', value: token.data.raw, mention: token.data });
      } else {
        segments.push({ type: 'messageLink', value: token.data.raw, link: token.data });
      }
      cursor = token.end;
    }
    // Text after last token
    if (cursor < seg.value.length) {
      segments.push({ type: 'text', value: seg.value.slice(cursor) });
    }
  }

  return segments;
}

function MentionRenderer({ mention }: { mention: ParsedMention }) {
  switch (mention.type) {
    case 'user':
      return <UserMentionBadge mention={mention} />;
    case 'channel':
      return <ChannelMentionBadge mention={mention} />;
    case 'role':
      return <RoleMentionBadge mention={mention} />;
    case 'here':
    case 'everyone':
      return <BroadcastMentionBadge type={mention.type} />;
    case 'time':
      return <TimeMentionBadge mention={mention} />;
    case 'motd':
      return <MOTDBadge />;
    default:
      return <span>{mention.raw}</span>;
  }
}

export function MessageContent({ content, isOwnMessage, compact, serverId }: MessageContentProps) {
  const segments = useMemo(() => parseContentSegments(content), [content]);
  // Subscribe to emoji manifest so we re-render when it loads
  const emojiManifest = useEmojiManifestStore((s) => serverId ? s.manifests.get(serverId) : undefined);
  void emojiManifest; // used implicitly by renderCustomEmojis via getState()

  return (
    <div className="message-content">
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'image':
            return (
              <ImageRenderer key={i} src={segment.value} isOwnMessage={isOwnMessage} compact={compact} />
            );
          case 'mention':
            return <MentionRenderer key={i} mention={segment.mention!} />;
          case 'messageLink':
            return <MessageLinkEmbed key={i} link={segment.link!} />;
          case 'text':
          default:
            return (
              <span key={i} className="break-words whitespace-pre-wrap">
                {renderCustomEmojis(segment.value, serverId)}
              </span>
            );
        }
      })}
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

  // Handle already-cached images (browser may not fire onLoad for cached imgs)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      handleLoad();
    }
  }, [src, handleLoad]);

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
