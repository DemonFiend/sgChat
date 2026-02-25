import { createSignal, Show, createEffect, createMemo, For } from 'solid-js';
import { isImageUrl, getImageType, extractImageUrls } from '@/lib/imageUtils';

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
 * Separate component for rendering images with loading states
 */
function ImageRenderer(props: { src: string; isOwnMessage?: boolean; compact?: boolean }) {
    const [imageLoaded, setImageLoaded] = createSignal(false);
    const [imageError, setImageError] = createSignal(false);

    // Reset loading/error state when src changes
    createEffect(() => {
        const _ = props.src;
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

    const getImageClasses = () => {
        if (props.compact) {
            return 'max-w-[200px] max-h-[150px] rounded-lg';
        }
        if (props.isOwnMessage !== undefined) {
            return 'max-w-[300px] max-h-[250px] rounded-2xl';
        }
        return 'max-w-[400px] max-h-[300px] rounded-lg';
    };

    const getContainerClasses = () => {
        const base = 'relative';
        if (props.compact) {
            return `${base} inline-block`;
        }
        return `${base} my-1`;
    };

    const imageType = createMemo(() => getImageType(props.src));
    const altText = createMemo(() => imageType() === 'gif' ? 'GIF animation' : 'Shared image');

    return (
        <div class={getContainerClasses()}>
            {/* Loading skeleton */}
            <Show when={!imageLoaded() && !imageError()}>
                <div
                    class={`${getImageClasses()} bg-bg-tertiary animate-pulse`}
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
                    alt={altText()}
                    class={`${getImageClasses()} object-contain bg-bg-tertiary ${imageLoaded() ? 'opacity-100' : 'opacity-0 absolute'}`}
                    style={{
                        transition: 'opacity 0.2s ease-in',
                        display: imageLoaded() ? 'block' : 'none'
                    }}
                    loading="lazy"
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                />
            </Show>

            {/* Error state - show descriptive fallback with link */}
            <Show when={imageError()}>
                <div class={`flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg border border-border text-text-muted ${props.compact ? 'text-xs' : 'text-sm'}`}>
                    <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div class="flex flex-col gap-0.5 min-w-0">
                        <span class="text-text-muted">
                            {imageType() === 'gif' ? 'Unable to load GIF' : 'Unable to load image'}
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
            </Show>
        </div>
    );
}
