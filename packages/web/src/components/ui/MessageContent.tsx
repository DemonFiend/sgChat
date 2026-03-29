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
import { renderMarkdown } from '@/lib/markdownParser';
import { useEmojiManifestStore } from '@/stores/emojiManifest';

const GIF_AUTOPLAY_DURATION = 6000;

export interface MessageContentProps {
  content: string;
  isOwnMessage?: boolean;
  compact?: boolean;
  serverId?: string;
}

// Non-image file extensions that should render as file cards
const FILE_EXTENSIONS = ['pdf', 'txt', 'zip', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'json', 'md'];

/**
 * Check if a URL points to a non-image uploaded file (e.g. MinIO uploads path).
 * Matches URLs containing /uploads/ with a non-image file extension.
 */
function isFileUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes(' ')) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Must be an uploads path
    if (!url.pathname.includes('/uploads/')) return false;
    // Must NOT be an image (images are handled separately)
    if (isImageUrl(trimmed)) return false;
    // Check for known file extensions
    const extMatch = url.pathname.match(/\.([a-z0-9]+)$/i);
    if (extMatch && FILE_EXTENSIONS.includes(extMatch[1].toLowerCase())) return true;
    // Even without a recognized extension, if it's in /uploads/ and not an image, treat as file
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse filename from a MinIO upload URL.
 * URL format: .../uploads/{userId}/{nanoid}-{filename}
 * Returns the original filename (after the nanoid hash prefix).
 */
function parseFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    // Format: {nanoid12chars}-{original_filename}
    // nanoid is 12 chars, followed by a dash, then the sanitized filename
    const dashIndex = lastPart.indexOf('-');
    if (dashIndex > 0 && dashIndex <= 20) {
      return decodeURIComponent(lastPart.substring(dashIndex + 1));
    }
    return decodeURIComponent(lastPart);
  } catch {
    return 'Unknown file';
  }
}

/**
 * Get a file type icon category from extension.
 */
function getFileIconType(filename: string): 'audio' | 'video' | 'document' | 'archive' | 'code' {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext || '')) return 'audio';
  if (['mp4', 'webm', 'avi', 'mkv', 'mov'].includes(ext || '')) return 'video';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext || '')) return 'archive';
  if (['json', 'md', 'js', 'ts', 'py', 'html', 'css'].includes(ext || '')) return 'code';
  return 'document';
}

interface ParsedSegment {
  type: 'text' | 'image' | 'spoilerImage' | 'mention' | 'messageLink' | 'file';
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

  // If entire content is a spoiler-wrapped image URL: ||url||
  const spoilerMatch = content.trim().match(/^\|\|(.+?)\|\|$/s);
  if (spoilerMatch && isImageUrl(spoilerMatch[1].trim())) {
    return [{ type: 'spoilerImage', value: spoilerMatch[1].trim() }];
  }

  // If entire content is a single image URL, render as image only
  if (isImageUrl(content)) {
    return [{ type: 'image', value: content }];
  }

  // If entire content is a single file URL, render as file card only
  if (isFileUrl(content)) {
    return [{ type: 'file', value: content }];
  }

  // First, split by image URLs and file URLs
  const imageUrls = extractImageUrls(content);
  const rawSegments: { type: 'text' | 'image' | 'file'; value: string }[] = [];

  // Also extract file URLs from content
  const fileUrlRegex = /https?:\/\/[^\s]+/g;
  const allFileUrls: string[] = [];
  let fileMatch;
  while ((fileMatch = fileUrlRegex.exec(content)) !== null) {
    if (isFileUrl(fileMatch[0])) {
      allFileUrls.push(fileMatch[0]);
    }
  }

  // Combine image and file URLs, sorted by position in content
  const allMediaUrls: { url: string; type: 'image' | 'file' }[] = [
    ...imageUrls.map((url) => ({ url, type: 'image' as const })),
    ...allFileUrls.map((url) => ({ url, type: 'file' as const })),
  ].sort((a, b) => content.indexOf(a.url) - content.indexOf(b.url));

  if (allMediaUrls.length === 0) {
    rawSegments.push({ type: 'text', value: content });
  } else {
    let remaining = content;
    for (const media of allMediaUrls) {
      const urlIndex = remaining.indexOf(media.url);
      if (urlIndex > 0) {
        const textBefore = remaining.substring(0, urlIndex).trim();
        if (textBefore) rawSegments.push({ type: 'text', value: textBefore });
      }
      rawSegments.push({ type: media.type, value: media.url });
      remaining = remaining.substring(urlIndex + media.url.length);
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
    if (seg.type === 'file') {
      segments.push({ type: 'file', value: seg.value });
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

function FileCard({ url }: { url: string }) {
  const filename = parseFilenameFromUrl(url);
  const iconType = getFileIconType(filename);

  const iconPath = {
    audio: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
    video: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    archive: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    code: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    document: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  }[iconType];

  return (
    <div className="my-1 max-w-[400px]">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 bg-bg-tertiary rounded-lg border border-border hover:border-brand-primary/50 hover:bg-bg-tertiary/80 transition-colors group"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={iconPath} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-brand-primary group-hover:underline truncate">
            {filename}
          </div>
          <div className="text-xs text-text-muted">
            Click to download
          </div>
        </div>
        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
    </div>
  );
}

/**
 * Render an attachment from the message's attachments array.
 * Exported for use in ChatPanel and DMChatPanel.
 */
export function AttachmentCard({ attachment }: { attachment: { url: string; filename: string; size: number; type: string; width?: number; height?: number } }) {
  const filename = attachment.filename || parseFilenameFromUrl(attachment.url);
  const isImage = attachment.type?.startsWith('image/');

  // Render image attachments as inline previews
  if (isImage) {
    return (
      <div className="my-1">
        <a href={attachment.url} target="_blank" rel="noopener noreferrer">
          <img
            src={attachment.url}
            alt={filename}
            className="max-w-[400px] max-h-[300px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
            loading="lazy"
          />
        </a>
      </div>
    );
  }

  // Non-image attachments render as download cards
  const iconType = getFileIconType(filename);

  const iconPath = {
    audio: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',
    video: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    archive: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
    code: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    document: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z',
  }[iconType];

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="my-1 max-w-[400px]">
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2.5 bg-bg-secondary rounded-lg border border-border hover:border-brand-primary/50 hover:bg-bg-secondary/80 transition-colors group"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d={iconPath} />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-brand-primary group-hover:underline truncate">
            {filename}
          </div>
          <div className="text-xs text-text-muted">
            {attachment.size ? formatSize(attachment.size) : 'Click to download'}
          </div>
        </div>
        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
    </div>
  );
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

  return (
    <div className="message-content">
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'spoilerImage':
            return (
              <SpoilerImageRenderer key={i} src={segment.value} isOwnMessage={isOwnMessage} compact={compact} />
            );
          case 'image':
            return (
              <ImageRenderer key={i} src={segment.value} isOwnMessage={isOwnMessage} compact={compact} />
            );
          case 'file':
            return <FileCard key={i} url={segment.value} />;
          case 'mention':
            return <MentionRenderer key={i} mention={segment.mention!} />;
          case 'messageLink':
            return <MessageLinkEmbed key={i} link={segment.link!} />;
          case 'text':
          default:
            return (
              <span key={i} className="break-words whitespace-pre-wrap">
                {renderMarkdown(segment.value, serverId, !!emojiManifest)}
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
          className={`${imageClasses} object-contain bg-bg-tertiary ${imageLoaded ? 'opacity-100 relative' : 'opacity-0 absolute pointer-events-none'}`}
          style={{ transition: 'opacity 0.2s ease-in' }}
          loading="lazy"
          onLoad={() => { setImageLoaded(true); setImageError(false); }}
          onError={() => { setImageLoaded(false); setImageError(true); }}
        />
      )}

      {imageError && <ImageErrorFallback src={src} isGif={false} compact={compact} />}
    </div>
  );
}

function SpoilerImageRenderer({ src, isOwnMessage, compact }: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageClasses = getImageClasses(compact, isOwnMessage);
  const containerClasses = getContainerClasses(compact);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setRevealed(false);
  }, [src]);

  return (
    <div className={containerClasses}>
      {!imageLoaded && !imageError && (
        <div
          className={`${imageClasses} bg-bg-tertiary animate-pulse`}
          style={{ width: compact ? '200px' : '300px', height: compact ? '150px' : '200px' }}
          aria-label="Loading spoiler image..."
        />
      )}

      {imageError && <ImageErrorFallback src={src} isGif={false} compact={compact} />}

      {!imageError && (
        <div
          className={`relative cursor-pointer group ${imageLoaded ? 'block' : 'hidden'}`}
          onClick={() => setRevealed((r) => !r)}
        >
          <img
            src={src}
            alt="Spoiler image"
            className={`${imageClasses} object-contain bg-bg-tertiary transition-all duration-300 ${!revealed ? 'blur-[40px] brightness-50' : ''}`}
            loading="lazy"
            onLoad={() => { setImageLoaded(true); setImageError(false); }}
            onError={() => { setImageLoaded(false); setImageError(true); }}
          />

          {!revealed && imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="px-4 py-2 rounded-lg bg-black/70 text-white font-bold text-sm uppercase tracking-wider">
                SPOILER
              </div>
            </div>
          )}
        </div>
      )}
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
