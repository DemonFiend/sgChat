import { createSignal, Show, createEffect, createMemo, For, onCleanup } from 'solid-js';
import { isImageUrl, getImageType, extractImageUrls } from '@/lib/imageUtils';

const GIF_AUTOPLAY_DURATION = 6000; // 6 seconds (~3 loops for typical GIFs)

export interface MessageContentProps {
    content: string;
    isOwnMessage?: boolean;
    compact?: boolean;
}

interface ParsedContent {
    type: 'text' | 'image';
    value: string;
}

/**
 * Smart message content renderer that detects and displays images
 * Supports both pure image URLs and mixed content with embedded images
 */
export function MessageContent(props: MessageContentProps) {
    // Parse content into text and image segments
    const parsedContent = createMemo((): ParsedContent[] => {
        const content = props.content;
        if (!content) return [];

        // Check if the entire content is just an image URL
        if (isImageUrl(content)) {
            return [{ type: 'image', value: content }];
        }

        // Extract image URLs from mixed content
        const imageUrls = extractImageUrls(content);
        
        if (imageUrls.length === 0) {
            // No images found, return as plain text
            return [{ type: 'text', value: content }];
        }

        // Parse content into segments of text and images
        const segments: ParsedContent[] = [];
        let remaining = content;

        for (const url of imageUrls) {
            const urlIndex = remaining.indexOf(url);
            if (urlIndex > 0) {
                // Add text before the URL
                const textBefore = remaining.substring(0, urlIndex).trim();
                if (textBefore) {
                    segments.push({ type: 'text', value: textBefore });
                }
            }
            // Add the image
            segments.push({ type: 'image', value: url });
            // Continue with remaining content
            remaining = remaining.substring(urlIndex + url.length);
        }

        // Add any remaining text
        const trimmedRemaining = remaining.trim();
        if (trimmedRemaining) {
            segments.push({ type: 'text', value: trimmedRemaining });
        }

        return segments;
    });

    return (
        <div class="message-content">
            <For each={parsedContent()}>
                {(segment) => (
                    <Show when={segment.type === 'image'} fallback={
                        <span class="break-words whitespace-pre-wrap">{segment.value}</span>
                    }>
                        <ImageRenderer
                            src={segment.value}
                            isOwnMessage={props.isOwnMessage}
                            compact={props.compact}
                        />
                    </Show>
                )}
            </For>
        </div>
    );
}

/**
 * Shared helper functions for image/GIF rendering
 */
function getImageClasses(compact?: boolean, isOwnMessage?: boolean): string {
    if (compact) {
        return 'max-w-[200px] max-h-[150px] rounded-lg';
    }
    if (isOwnMessage !== undefined) {
        return 'max-w-[300px] max-h-[250px] rounded-2xl';
    }
    return 'max-w-[400px] max-h-[300px] rounded-lg';
}

function getContainerClasses(compact?: boolean): string {
    const base = 'relative';
    if (compact) {
        return `${base} inline-block`;
    }
    return `${base} my-1`;
}

/**
 * Error fallback component for failed image/GIF loads
 */
function ImageErrorFallback(props: { src: string; isGif: boolean; compact?: boolean }) {
    return (
        <div class={`flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border text-text-muted ${props.compact ? 'text-xs' : 'text-sm'}`}>
            <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div class="flex flex-col gap-0.5 min-w-0">
                <span class="text-text-muted">
                    {props.isGif ? 'Unable to load GIF' : 'Unable to load image'}
                </span>
                <a 
                    href={props.src} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    class="text-brand-primary hover:underline truncate text-xs"
                >
                    {props.src}
                </a>
            </div>
        </div>
    );
}

/**
 * GIF renderer with autoplay control (plays ~3 loops then pauses)
 */
function GifRenderer(props: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
    const [isPlaying, setIsPlaying] = createSignal(true);
    const [imageLoaded, setImageLoaded] = createSignal(false);
    const [imageError, setImageError] = createSignal(false);
    const [staticFrame, setStaticFrame] = createSignal<string | null>(null);
    
    let autoplayTimer: ReturnType<typeof setTimeout> | null = null;
    let imgRef: HTMLImageElement | undefined;
    let canvasRef: HTMLCanvasElement | undefined;

    // Capture current frame to canvas for static display
    const captureFrame = () => {
        if (!imgRef || !canvasRef || !imageLoaded()) return;
        
        try {
            const ctx = canvasRef.getContext('2d');
            if (!ctx) return;
            
            // Set canvas size to match image natural dimensions
            canvasRef.width = imgRef.naturalWidth;
            canvasRef.height = imgRef.naturalHeight;
            
            // Draw current frame
            ctx.drawImage(imgRef, 0, 0);
            
            // Get data URL
            const dataUrl = canvasRef.toDataURL('image/png');
            setStaticFrame(dataUrl);
        } catch (e) {
            // CORS error - can't capture frame, just hide the image instead
            console.warn('[GifRenderer] Could not capture frame (CORS):', e);
            setStaticFrame('cors-blocked');
        }
    };

    // Start autoplay timer when GIF loads
    const startAutoplayTimer = () => {
        if (autoplayTimer) {
            clearTimeout(autoplayTimer);
        }
        
        autoplayTimer = setTimeout(() => {
            captureFrame();
            setIsPlaying(false);
        }, GIF_AUTOPLAY_DURATION);
    };

    // Handle GIF load
    const handleLoad = () => {
        setImageLoaded(true);
        setImageError(false);
        
        if (isPlaying()) {
            startAutoplayTimer();
        }
    };

    // Handle GIF error
    const handleError = () => {
        setImageLoaded(false);
        setImageError(true);
        if (autoplayTimer) {
            clearTimeout(autoplayTimer);
        }
    };

    // Handle click to replay
    const handleClick = () => {
        if (isPlaying()) return;
        
        setIsPlaying(true);
        setStaticFrame(null);
        
        // Force reload the GIF to restart animation
        if (imgRef) {
            const src = imgRef.src;
            imgRef.src = '';
            imgRef.src = src;
        }
        
        startAutoplayTimer();
    };

    // Reset state when src changes
    createEffect(() => {
        void props.src;
        setIsPlaying(true);
        setImageLoaded(false);
        setImageError(false);
        setStaticFrame(null);
        
        if (autoplayTimer) {
            clearTimeout(autoplayTimer);
        }
    });

    // Cleanup timer on unmount
    onCleanup(() => {
        if (autoplayTimer) {
            clearTimeout(autoplayTimer);
        }
    });

    const imageClasses = () => getImageClasses(props.compact, props.isOwnMessage);
    const containerClasses = () => getContainerClasses(props.compact);

    return (
        <div class={containerClasses()}>
            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} class="hidden" />
            
            {/* Loading skeleton */}
            <Show when={!imageLoaded() && !imageError()}>
                <div
                    class={`${imageClasses()} bg-bg-tertiary animate-pulse`}
                    style={{ 
                        width: props.compact ? '200px' : '300px', 
                        height: props.compact ? '150px' : '200px' 
                    }}
                    aria-label="Loading GIF..."
                />
            </Show>

            {/* Error state */}
            <Show when={imageError()}>
                <ImageErrorFallback src={props.src} isGif={true} compact={props.compact} />
            </Show>

            {/* GIF display */}
            <Show when={!imageError()}>
                <div 
                    class={`relative cursor-pointer group ${imageLoaded() ? 'block' : 'hidden'}`}
                    onClick={handleClick}
                >
                    {/* Animated GIF (hidden when paused with captured frame) */}
                    <img
                        ref={imgRef}
                        src={props.src}
                        alt="GIF animation"
                        class={`${imageClasses()} object-contain bg-bg-tertiary ${!isPlaying() && staticFrame() && staticFrame() !== 'cors-blocked' ? 'hidden' : ''}`}
                        loading="lazy"
                        onLoad={handleLoad}
                        onError={handleError}
                    />
                    
                    {/* Static frame (shown when paused) */}
                    <Show when={!isPlaying() && staticFrame() && staticFrame() !== 'cors-blocked'}>
                        <img
                            src={staticFrame()!}
                            alt="GIF (paused)"
                            class={`${imageClasses()} object-contain bg-bg-tertiary`}
                        />
                    </Show>
                    
                    {/* Play button overlay (shown when paused) */}
                    <Show when={!isPlaying() && imageLoaded()}>
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg transition-opacity group-hover:bg-black/40">
                            <div class="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg transform transition-transform group-hover:scale-110">
                                <svg class="w-6 h-6 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            </div>
                        </div>
                    </Show>
                    
                    {/* GIF badge */}
                    <Show when={imageLoaded()}>
                        <div class="absolute bottom-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-bold text-white uppercase">
                            GIF
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    );
}

/**
 * Separate component for rendering static images with loading states
 */
function StaticImageRenderer(props: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
    const [imageLoaded, setImageLoaded] = createSignal(false);
    const [imageError, setImageError] = createSignal(false);

    // Reset loading/error state when src changes
    createEffect(() => {
        void props.src;
        setImageLoaded(false);
        setImageError(false);
    });

    const handleImageLoad = () => {
        setImageLoaded(true);
        setImageError(false);
    };

    const handleImageError = () => {
        setImageLoaded(false);
        setImageError(true);
    };

    const imageClasses = () => getImageClasses(props.compact, props.isOwnMessage);
    const containerClasses = () => getContainerClasses(props.compact);

    return (
        <div class={containerClasses()}>
            {/* Loading skeleton */}
            <Show when={!imageLoaded() && !imageError()}>
                <div
                    class={`${imageClasses()} bg-bg-tertiary animate-pulse`}
                    style={{ 
                        width: props.compact ? '200px' : '300px', 
                        height: props.compact ? '150px' : '200px' 
                    }}
                    aria-label="Loading image..."
                />
            </Show>

            {/* Actual image */}
            <Show when={!imageError()}>
                <img
                    src={props.src}
                    alt="Shared image"
                    class={`${imageClasses()} object-contain bg-bg-tertiary ${imageLoaded() ? 'opacity-100' : 'opacity-0 absolute'}`}
                    style={{
                        transition: 'opacity 0.2s ease-in',
                        display: imageLoaded() ? 'block' : 'none'
                    }}
                    loading="lazy"
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                />
            </Show>

            {/* Error state */}
            <Show when={imageError()}>
                <ImageErrorFallback src={props.src} isGif={false} compact={props.compact} />
            </Show>
        </div>
    );
}

/**
 * Main image renderer that delegates to GIF or static image renderer
 */
function ImageRenderer(props: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
    const imageType = createMemo(() => getImageType(props.src));
    const isGif = () => imageType() === 'gif';

    return (
        <Show 
            when={isGif()} 
            fallback={<StaticImageRenderer src={props.src} isOwnMessage={props.isOwnMessage} compact={props.compact} />}
        >
            <GifRenderer src={props.src} isOwnMessage={props.isOwnMessage} compact={props.compact} />
        </Show>
    );
}
