import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { serverPopupStore } from '@/stores';

// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

export function ServerWelcomePopup() {
    const [currentTime, setCurrentTime] = createSignal('');
    const [isClosing, setIsClosing] = createSignal(false);
    let timeInterval: ReturnType<typeof setInterval> | null = null;
    let modalRef: HTMLDivElement | undefined;
    let firstFocusableElement: HTMLElement | null = null;
    let lastFocusableElement: HTMLElement | null = null;

    const state = () => serverPopupStore.state();
    const isVisible = () => state().isVisible;
    const serverData = () => state().serverData;
    const isLoading = () => state().isLoading;
    const error = () => state().error;

    // Update time every second when popup is visible
    createEffect(() => {
        if (isVisible() && serverData()) {
            updateTime();
            timeInterval = setInterval(updateTime, 1000);
        } else if (timeInterval) {
            clearInterval(timeInterval);
            timeInterval = null;
        }
    });

    onCleanup(() => {
        if (timeInterval) {
            clearInterval(timeInterval);
        }
    });

    const updateTime = () => {
        const data = serverData();
        if (!data) return;

        try {
            const timezone = data.timezone || 'UTC';
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
            setCurrentTime(formatter.format(now));
        } catch (err) {
            console.warn('[ServerWelcomePopup] Invalid timezone, falling back to UTC:', err);
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'UTC',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });
            setCurrentTime(formatter.format(now));
        }
    };

    const handleClose = () => {
        setIsClosing(true);
        // Wait for fade-out animation before actually closing
        setTimeout(() => {
            serverPopupStore.dismissPopup();
            setIsClosing(false);
        }, 200);
    };

    const handleRetry = () => {
        serverPopupStore.retry();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleClose();
        }

        // Focus trap
        if (e.key === 'Tab' && modalRef) {
            const focusableElements = modalRef.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );

            firstFocusableElement = focusableElements[0] || null;
            lastFocusableElement = focusableElements[focusableElements.length - 1] || null;

            if (e.shiftKey) {
                // Shift + Tab
                if (document.activeElement === firstFocusableElement) {
                    lastFocusableElement?.focus();
                    e.preventDefault();
                }
            } else {
                // Tab
                if (document.activeElement === lastFocusableElement) {
                    firstFocusableElement?.focus();
                    e.preventDefault();
                }
            }
        }
    };

    // Focus management
    createEffect(() => {
        if (isVisible() && modalRef) {
            // Focus first focusable element when modal opens
            const focusableElements = modalRef.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            firstFocusableElement = focusableElements[0] || null;
            firstFocusableElement?.focus();
        }
    });

    // Sanitize and render markdown
    const renderMarkdown = (text: string | null | undefined): string => {
        if (!text) return '';
        const rawHtml = marked.parse(text) as string;
        return DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'],
            ALLOWED_ATTR: ['href', 'target', 'rel'],
        });
    };

    return (
        <Show when={isVisible()}>
            <Portal>
                <div
                    class={`fixed inset-0 z-[200] flex items-center justify-center transition-opacity duration-200 ${isClosing() ? 'opacity-0' : 'opacity-100 animate-in fade-in'
                        }`}
                    onKeyDown={handleKeyDown}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Server Welcome"
                >
                    {/* Backdrop */}
                    <div
                        class="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={handleClose}
                    />

                    {/* Modal Container */}
                    <div
                        ref={modalRef}
                        class={`relative bg-bg-primary rounded-lg shadow-2xl w-full max-w-[600px] max-h-[80vh] mx-4 overflow-hidden border border-border-subtle flex flex-col transition-all duration-200 ${isClosing() ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                            } sm:w-[90vw] sm:max-w-[90vw]`}
                    >
                        <Show when={isLoading()}>
                            {/* Loading State */}
                            <div class="flex items-center justify-center p-8">
                                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
                            </div>
                        </Show>

                        <Show when={error()}>
                            {/* Error State */}
                            <div class="flex flex-col items-center justify-center p-8 gap-4">
                                <div class="text-danger text-center">
                                    <svg class="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <p class="text-sm font-medium">{error()}</p>
                                </div>
                                <div class="flex gap-2">
                                    <button
                                        onClick={handleRetry}
                                        class="px-4 py-2 bg-brand-primary hover:bg-brand-hover text-white rounded transition-colors"
                                    >
                                        Retry
                                    </button>
                                    <button
                                        onClick={handleClose}
                                        class="px-4 py-2 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary rounded transition-colors"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </Show>

                        <Show when={!isLoading() && !error() && serverData()}>
                            {/* Header */}
                            <div class="flex items-center justify-between p-4 border-b border-border-subtle flex-shrink-0">
                                <h2 class="text-xl font-bold text-text-primary truncate pr-4">
                                    {serverData()?.serverName || 'Server'}
                                </h2>
                                <button
                                    onClick={handleClose}
                                    class="flex-shrink-0 p-3 hover:bg-bg-modifier-hover rounded-full transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                                    aria-label="Close"
                                >
                                    <svg class="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            {/* Scrollable Content */}
                            <div class="flex-1 overflow-y-auto">
                                {/* Banner */}
                                <div class="relative w-full" style="padding-bottom: 56.25%;">
                                    <Show
                                        when={serverData()?.bannerUrl}
                                        fallback={
                                            <div class="absolute inset-0 bg-gradient-to-br from-brand-primary/60 via-brand-secondary/60 to-brand-tertiary/60" />
                                        }
                                    >
                                        <img
                                            src={serverData()!.bannerUrl!}
                                            alt="Server banner"
                                            class="absolute inset-0 w-full h-full object-cover"
                                        />
                                    </Show>
                                </div>

                                {/* Server Time Display */}
                                <div class="px-6 pt-6 pb-4">
                                    <div class="flex items-center gap-3 text-text-muted">
                                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div class="flex items-baseline gap-2">
                                            <span class="text-2xl font-mono font-bold text-text-primary tabular-nums">
                                                {currentTime()}
                                            </span>
                                            <span class="text-sm">
                                                {serverData()?.timezone || 'UTC'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* MOTD Section */}
                                <Show when={serverData()?.motd}>
                                    <div class="px-6 pb-4">
                                        <h3 class="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                            Message of the Day
                                        </h3>
                                        <div class="relative">
                                            <div
                                                class="prose prose-sm max-w-none text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle overflow-auto"
                                                style="max-height: 200px;"
                                                innerHTML={renderMarkdown(serverData()?.motd)}
                                            />
                                            {/* Fade gradient for long content */}
                                            <Show when={(serverData()?.motd?.length || 0) > 1000}>
                                                <div class="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-tertiary/60 to-transparent pointer-events-none rounded-b" />
                                            </Show>
                                        </div>
                                    </div>
                                </Show>

                                {/* Show fallback if no MOTD */}
                                <Show when={!serverData()?.motd}>
                                    <div class="px-6 pb-4">
                                        <h3 class="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                            Message of the Day
                                        </h3>
                                        <div class="text-sm text-text-muted italic bg-bg-tertiary/30 rounded p-3 border border-border-subtle">
                                            No message of the day
                                        </div>
                                    </div>
                                </Show>

                                {/* Welcome Message Section */}
                                <div class="px-6 pb-6">
                                    <h3 class="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                        Welcome!
                                    </h3>
                                    <Show
                                        when={serverData()?.welcomeMessage}
                                        fallback={
                                            <div class="text-sm text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle">
                                                Welcome to <span class="font-semibold">{serverData()?.serverName}</span>!
                                            </div>
                                        }
                                    >
                                        <div class="relative">
                                            <div
                                                class="prose prose-sm max-w-none text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle overflow-auto"
                                                style="max-height: 200px;"
                                                innerHTML={renderMarkdown(serverData()?.welcomeMessage)}
                                            />
                                            {/* Fade gradient for long content */}
                                            <Show when={(serverData()?.welcomeMessage?.length || 0) > 1000}>
                                                <div class="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-tertiary/60 to-transparent pointer-events-none rounded-b" />
                                            </Show>
                                        </div>
                                    </Show>
                                </div>
                            </div>
                        </Show>
                    </div>
                </div>
            </Portal>
        </Show>
    );
}
