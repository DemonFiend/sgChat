import { createSignal, Show, onMount } from 'solid-js';
import { isImageUrl, getImageType } from '@/lib/imageUtils';

export interface MessageContentProps {
    content: string;
    isOwnMessage?: boolean;
    compact?: boolean;
}

/**
 * Smart message content renderer that detects and displays images
 * Falls back to text rendering for non-image content
 */
export function MessageContent(props: MessageContentProps) {
    const [imageLoaded, setImageLoaded] = createSignal(false);
    const [imageError, setImageError] = createSignal(false);
    const [isImage, setIsImage] = createSignal(false);

    // Check if content is an image URL on mount
    onMount(() => {
        setIsImage(isImageUrl(props.content));
    });

    // Handle image load success
    const handleImageLoad = () => {
        setImageLoaded(true);
        setImageError(false);
    };

    // Handle image load error
    const handleImageError = () => {
        setImageLoaded(false);
        setImageError(true);
    };

    // Get appropriate styling based on context
    const getImageClasses = () => {
        if (props.compact) {
            return 'max-w-[200px] max-h-[150px] rounded-lg';
        }
        if (props.isOwnMessage !== undefined) {
            // DM context - fit within bubble
            return 'max-w-[300px] max-h-[250px] rounded-2xl';
        }
        // Channel context - larger
        return 'max-w-[400px] max-h-[300px] rounded-lg';
    };

    const getContainerClasses = () => {
        const base = 'relative';
        if (props.compact) {
            return `${base} inline-block`;
        }
        return `${base} my-1`;
    };

    // Render image if detected
    const renderImage = () => {
        const imageType = getImageType(props.content);
        const altText = imageType === 'gif' ? 'GIF animation' : 'Shared image';

        return (
            <div class={getContainerClasses()}>
                {/* Loading skeleton */}
                <Show when={!imageLoaded() && !imageError()}>
                    <div
                        class={`${getImageClasses()} bg-bg-tertiary animate-pulse`}
                        style={{ width: props.compact ? '200px' : '300px', height: props.compact ? '150px' : '200px' }}
                        aria-label="Loading image..."
                    />
                </Show>

                {/* Actual image */}
                <Show when={!imageError()}>
                    <img
                        src={props.content}
                        alt={altText}
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

                {/* Error state */}
                <Show when={imageError()}>
                    <div class={`flex items-center gap-2 px-3 py-2 bg-bg-tertiary rounded-lg text-text-muted ${props.compact ? 'text-xs' : 'text-sm'}`}>
                        <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span>Unable to load image</span>
                    </div>
                </Show>
            </div>
        );
    };

    // Render text content
    const renderText = () => {
        return (
            <span class="break-words whitespace-pre-wrap">{props.content}</span>
        );
    };

    return (
        <Show when={isImage()} fallback={renderText()}>
            {renderImage()}
        </Show>
    );
}
