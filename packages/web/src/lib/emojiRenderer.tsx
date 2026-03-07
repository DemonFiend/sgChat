import React from 'react';
import { useEmojiManifestStore } from '@/stores/emojiManifest';

/**
 * Render text with :shortcode: patterns replaced by custom emoji images.
 * Returns an array of React nodes (strings and img elements).
 */
export function renderCustomEmojis(text: string, serverId?: string): (string | React.ReactElement)[] {
  if (!serverId || !text.includes(':')) return [text];

  const manifest = useEmojiManifestStore.getState().manifests.get(serverId);
  if (!manifest || manifest.emojis.length === 0) return [text];

  const parts: (string | React.ReactElement)[] = [];
  const regex = /:([a-zA-Z0-9_]{2,32}):/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const shortcode = match[1];
    const emoji = manifest.emojis.find((e) => e.shortcode === shortcode);

    if (emoji) {
      // Check if the pack is enabled
      const pack = manifest.packs.find((p) => p.id === emoji.pack_id);
      if (!pack || !pack.enabled) {
        // Pack disabled, leave as literal text
        continue;
      }

      // Add text before this match
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      // Add emoji image
      const url = emoji.url || emoji.asset_key;
      parts.push(
        <img
          key={`emoji-${match.index}`}
          src={url}
          alt={`:${shortcode}:`}
          title={`:${shortcode}:`}
          className="inline-block align-text-bottom"
          style={{ width: '1.375em', height: '1.375em' }}
          loading="lazy"
        />,
      );

      lastIndex = match.index + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no emojis were found, return original text
  if (parts.length === 0) return [text];

  return parts;
}

/**
 * React hook version for use in components.
 * Subscribes to manifest updates so emojis refresh when manifest changes.
 */
export function useCustomEmojiText(text: string, serverId?: string): (string | React.ReactElement)[] {
  // Subscribe to manifest changes for this server
  const manifest = useEmojiManifestStore((s) =>
    serverId ? s.manifests.get(serverId) : undefined,
  );

  if (!serverId || !text.includes(':') || !manifest) return [text];

  return renderCustomEmojis(text, serverId);
}
