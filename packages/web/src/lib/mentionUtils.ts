/**
 * Mention utilities for textarea display-text ↔ wire-format conversion
 * and @stime time input parsing.
 */

export interface MentionMapping {
  displayText: string;
  wireFormat: string;
  startIndex: number;
}

/**
 * Convert display text in textarea to wire format for sending.
 * Replaces all mapped display texts with their wire-format equivalents.
 */
export function convertMentionsToWireFormat(
  text: string,
  mappings: MentionMapping[],
): string {
  // Sort by startIndex descending so replacements don't shift earlier indices
  const sorted = [...mappings].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;
  for (const mapping of sorted) {
    const end = mapping.startIndex + mapping.displayText.length;
    if (result.slice(mapping.startIndex, end) === mapping.displayText) {
      result = result.slice(0, mapping.startIndex) + mapping.wireFormat + result.slice(end);
    }
  }
  return result;
}

/**
 * Shift all mapping indices after a given position by a delta.
 * Call this whenever the user types before existing mentions.
 */
export function shiftMappings(
  mappings: MentionMapping[],
  afterIndex: number,
  delta: number,
): MentionMapping[] {
  return mappings.map((m) =>
    m.startIndex >= afterIndex ? { ...m, startIndex: m.startIndex + delta } : m,
  );
}

/**
 * Remove any mappings that overlap with a deleted range.
 */
export function pruneMappings(
  mappings: MentionMapping[],
  deleteStart: number,
  deleteEnd: number,
): MentionMapping[] {
  return mappings.filter((m) => {
    const mEnd = m.startIndex + m.displayText.length;
    return mEnd <= deleteStart || m.startIndex >= deleteEnd;
  });
}

/**
 * Parse user-entered time string into a UTC unix timestamp (seconds).
 * Supports: 3pm, 3:00PM, 15:00, 3:30pm, 3 PM
 * Assumes the time is in the user's local timezone for today.
 */
export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(/\s+/g, '');

  // 24-hour format: 15:00, 15:30
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return hoursMinutesToTimestamp(h, m);
    }
  }

  // 12-hour format: 3pm, 3:00pm, 3:30pm, 12am
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2] ? parseInt(match12[2], 10) : 0;
    const period = match12[3];
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return hoursMinutesToTimestamp(h, m);
    }
  }

  return null;
}

function hoursMinutesToTimestamp(hours: number, minutes: number): number {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  return Math.floor(date.getTime() / 1000);
}
