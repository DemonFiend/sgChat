import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useServerPopupStore } from '@/stores/serverPopup';
import { authStore } from '@/stores/auth';

// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

export function ServerWelcomePopup() {
    const [currentTime, setCurrentTime] = useState('');
    const [isClosing, setIsClosing] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    const isVisible = useServerPopupStore(s => s.isVisible);
    const serverData = useServerPopupStore(s => s.serverData);
    const isLoading = useServerPopupStore(s => s.isLoading);
    const error = useServerPopupStore(s => s.error);

    const updateTime = useCallback(() => {
        const data = useServerPopupStore.getState().serverData;
        if (!data) return;

        try {
            const timezone = data.timezone || 'UTC';
            const timeFormat = data.timeFormat || '24h';
            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: timeFormat === '12h',
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
    }, []);

    // Update time every second when popup is visible
    useEffect(() => {
        if (isVisible && serverData) {
            updateTime();
            const timeInterval = setInterval(updateTime, 1000);
            return () => clearInterval(timeInterval);
        }
    }, [isVisible, serverData, updateTime]);

    // Focus management when modal opens
    useEffect(() => {
        if (isVisible && modalRef.current) {
            const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const firstElement = focusableElements[0] || null;
            firstElement?.focus();
        }
    }, [isVisible]);

    const handleClose = useCallback(() => {
        setIsClosing(true);
        // Wait for fade-out animation before actually closing
        setTimeout(() => {
            useServerPopupStore.getState().dismissPopup();
            setIsClosing(false);
        }, 200);
    }, []);

    const handleRetry = useCallback(() => {
        useServerPopupStore.getState().retry();
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleClose();
        }

        // Focus trap
        if (e.key === 'Tab' && modalRef.current) {
            const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );

            const firstFocusableElement = focusableElements[0] || null;
            const lastFocusableElement = focusableElements[focusableElements.length - 1] || null;

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
    }, [handleClose]);

    // Substitute template variables in text
    const substituteVariables = useCallback((text: string): string => {
        const user = authStore.getState().user;
        const data = useServerPopupStore.getState().serverData;
        return text
            .replace(/\{username\}/gi, user?.display_name || user?.username || 'User')
            .replace(/\{servername\}/gi, data?.serverName || '')
            .replace(/\{servericon\}/gi, data?.bannerUrl || '')
            .replace(/\{servertime\}/gi, currentTime || '')
            .replace(/\{if:([^}]*)\}([\s\S]*?)\{\/if\}/gi, (_match, _cond, body) => body);
    }, [currentTime]);

    // Sanitize and render markdown
    const renderMarkdown = useCallback((text: string | null | undefined): string => {
        if (!text) return '';
        const rawHtml = marked.parse(text) as string;
        return DOMPurify.sanitize(rawHtml, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'],
            ALLOWED_ATTR: ['href', 'target', 'rel'],
        });
    }, []);

    if (!isVisible) return null;

    return createPortal(
        <div
            className={`fixed inset-0 z-[200] flex items-center justify-center transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100 animate-in fade-in'
                }`}
            onKeyDown={handleKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label="Server Welcome"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                onClick={handleClose}
            />

            {/* Modal Container */}
            <div
                ref={modalRef}
                className={`relative bg-bg-primary rounded-lg shadow-2xl w-full max-w-[600px] max-h-[80vh] mx-4 overflow-hidden border border-border-subtle flex flex-col transition-all duration-200 ${isClosing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                    } sm:w-[90vw] sm:max-w-[90vw]`}
            >
                {isLoading && (
                    /* Loading State */
                    <div className="flex items-center justify-center p-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
                    </div>
                )}

                {error && (
                    /* Error State */
                    <div className="flex flex-col items-center justify-center p-8 gap-4">
                        <div className="text-danger text-center">
                            <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={handleRetry}
                                className="px-4 py-2 bg-brand-primary hover:bg-brand-hover text-white rounded transition-colors"
                            >
                                Retry
                            </button>
                            <button
                                onClick={handleClose}
                                className="px-4 py-2 bg-bg-tertiary hover:bg-bg-modifier-hover text-text-primary rounded transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {!isLoading && !error && serverData && (
                    <>
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border-subtle flex-shrink-0">
                            <h2 className="text-xl font-bold text-text-primary truncate pr-4">
                                {serverData.serverName || 'Server'}
                            </h2>
                            <button
                                onClick={handleClose}
                                className="flex-shrink-0 p-3 hover:bg-bg-modifier-hover rounded-full transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                                aria-label="Close"
                            >
                                <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Scrollable Content */}
                        <div className="flex-1 overflow-y-auto">
                            {/* Banner */}
                            <div className="relative w-full" style={{ paddingBottom: '25%' }}>
                                {serverData.bannerUrl ? (
                                    <img
                                        src={serverData.bannerUrl}
                                        alt="Server banner"
                                        className="absolute inset-0 w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/60 via-brand-secondary/60 to-brand-tertiary/60" />
                                )}
                            </div>

                            {/* Server Time Display */}
                            <div className="px-6 pt-3 pb-2">
                                <div className="flex items-center gap-3 text-text-muted">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-mono font-bold text-text-primary tabular-nums">
                                            {currentTime}
                                        </span>
                                        <span className="text-sm">
                                            {serverData.timezone || 'UTC'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* MOTD Section */}
                            {serverData.motd ? (
                                <div className="px-6 pb-4">
                                    <h3 className="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                        Message of the Day
                                    </h3>
                                    <div className="relative">
                                        <div
                                            className="prose prose-sm max-w-none text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle overflow-auto"
                                            style={{ maxHeight: '200px' }}
                                            dangerouslySetInnerHTML={{ __html: renderMarkdown(substituteVariables(serverData.motd)) }}
                                        />
                                        {/* Fade gradient for long content */}
                                        {(serverData.motd.length || 0) > 1000 && (
                                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-tertiary/60 to-transparent pointer-events-none rounded-b" />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* Show fallback if no MOTD */
                                <div className="px-6 pb-4">
                                    <h3 className="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                        Message of the Day
                                    </h3>
                                    <div className="text-sm text-text-muted italic bg-bg-tertiary/30 rounded p-3 border border-border-subtle">
                                        No message of the day
                                    </div>
                                </div>
                            )}

                            {/* Welcome Message Section */}
                            <div className="px-6 pb-4">
                                <h3 className="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                    Welcome!
                                </h3>
                                {serverData.welcomeMessage ? (
                                    <div className="relative">
                                        <div
                                            className="prose prose-sm max-w-none text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle overflow-auto"
                                            style={{ maxHeight: '200px' }}
                                            dangerouslySetInnerHTML={{ __html: renderMarkdown(substituteVariables(serverData.welcomeMessage)) }}
                                        />
                                        {/* Fade gradient for long content */}
                                        {(serverData.welcomeMessage.length || 0) > 1000 && (
                                            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg-tertiary/60 to-transparent pointer-events-none rounded-b" />
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-sm text-text-primary bg-bg-tertiary/30 rounded p-3 border border-border-subtle">
                                        Welcome to <span className="font-semibold">{serverData.serverName}</span>!
                                    </div>
                                )}
                            </div>

                            {/* Events Section */}
                            {serverData.events && serverData.events.filter(e => e.enabled).length > 0 && (
                                <div className="px-6 pb-6">
                                    <h3 className="text-xs font-bold uppercase text-text-muted mb-2 tracking-wide">
                                        Events
                                    </h3>
                                    <div className="space-y-2">
                                        {serverData.events.filter(e => e.enabled).map((event) => (
                                            <div
                                                key={event.id}
                                                className="bg-bg-tertiary/30 rounded p-3 border border-border-subtle"
                                            >
                                                <div className="flex items-center gap-2 mb-1.5">
                                                    <span
                                                        className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                                                            event.type === 'announcement'
                                                                ? 'bg-brand-primary/20 text-brand-primary'
                                                                : event.type === 'poll'
                                                                  ? 'bg-warning/20 text-warning'
                                                                  : 'bg-success/20 text-success'
                                                        }`}
                                                    >
                                                        {event.type === 'announcement' ? 'Announcement' : event.type === 'poll' ? 'Poll' : 'Scheduled'}
                                                    </span>
                                                    <span className="text-sm font-semibold text-text-primary">
                                                        {event.title}
                                                    </span>
                                                </div>
                                                {event.content && (
                                                    <div
                                                        className="prose prose-sm max-w-none text-text-primary text-sm"
                                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(substituteVariables(event.content)) }}
                                                    />
                                                )}
                                                {(event.startDate || event.endDate) && (
                                                    <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
                                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                        <span>
                                                            {event.startDate && new Date(event.startDate).toLocaleString(undefined, {
                                                                month: 'short', day: 'numeric', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                            {event.startDate && event.endDate && ' — '}
                                                            {event.endDate && new Date(event.endDate).toLocaleString(undefined, {
                                                                month: 'short', day: 'numeric', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit',
                                                            })}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
