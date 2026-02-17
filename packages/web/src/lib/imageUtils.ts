/**
 * Image URL Detection Utilities
 * 
 * Provides functions to detect and validate image URLs in message content
 */

// Common image file extensions
const IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'bmp', 'ico'];

// Known image hosting domains that may not have extensions in URLs
const IMAGE_HOSTING_DOMAINS = [
    'giphy.com',
    'media.giphy.com',
    'i.giphy.com',
    'imgur.com',
    'i.imgur.com',
    'media.tenor.com',
    'c.tenor.com',
];

/**
 * Check if a string is a valid URL
 */
function isValidUrl(text: string): boolean {
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Extract file extension from URL (before query parameters)
 */
function getFileExtension(url: string): string | null {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const match = pathname.match(/\.([a-z0-9]+)$/i);
        return match ? match[1].toLowerCase() : null;
    } catch {
        return null;
    }
}

/**
 * Check if URL belongs to a known image hosting domain
 */
function isImageHostingDomain(url: string): boolean {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        return IMAGE_HOSTING_DOMAINS.some(domain =>
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch {
        return false;
    }
}

/**
 * Detect if a string is a direct image URL
 * 
 * @param text - The text to check
 * @returns true if the text is a direct image URL
 */
export function isImageUrl(text: string): boolean {
    // Must be a single trimmed line (no newlines or multiple URLs)
    const trimmed = text.trim();
    if (!trimmed || trimmed.includes('\n') || trimmed.includes(' ')) {
        return false;
    }

    // Must be a valid URL
    if (!isValidUrl(trimmed)) {
        return false;
    }

    // Check file extension
    const extension = getFileExtension(trimmed);
    if (extension && IMAGE_EXTENSIONS.includes(extension)) {
        return true;
    }

    // Check if it's from a known image hosting domain
    // (Giphy and Imgur often don't include extensions)
    if (isImageHostingDomain(trimmed)) {
        return true;
    }

    return false;
}

/**
 * Get the image type from a URL
 * 
 * @param url - The image URL
 * @returns The image type or 'unknown'
 */
export function getImageType(url: string): 'gif' | 'png' | 'jpg' | 'webp' | 'svg' | 'unknown' {
    const extension = getFileExtension(url);

    if (!extension) {
        // Try to detect from URL patterns
        if (url.includes('giphy') || url.includes('tenor')) {
            return 'gif';
        }
        return 'unknown';
    }

    switch (extension) {
        case 'gif':
            return 'gif';
        case 'png':
            return 'png';
        case 'jpg':
        case 'jpeg':
            return 'jpg';
        case 'webp':
            return 'webp';
        case 'svg':
            return 'svg';
        default:
            return 'unknown';
    }
}

/**
 * Extract all image URLs from text (for future use)
 * 
 * @param text - The text to search
 * @returns Array of image URLs found
 */
export function extractImageUrls(text: string): string[] {
    const urls: string[] = [];
    const urlRegex = /https?:\/\/[^\s]+/g;
    const matches = text.match(urlRegex);

    if (matches) {
        for (const match of matches) {
            if (isImageUrl(match)) {
                urls.push(match);
            }
        }
    }

    return urls;
}
