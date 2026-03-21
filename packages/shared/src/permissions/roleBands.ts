/**
 * Role Band System
 *
 * Every role occupies a unique position within a defined band range.
 * Higher position = higher authority in the hierarchy.
 * Position 999 is reserved (owner bypass via servers.owner_id, no actual role).
 */

export const ROLE_BANDS = {
  OWNER: { min: 999, max: 999 },
  ADMIN: { min: 900, max: 998 },
  MODERATOR: { min: 800, max: 899 },
  MEMBER: { min: 600, max: 799 },
  FREE: { min: 276, max: 599 },
  COLOR: { min: 226, max: 275 },
  SERVER_ACCESS: { min: 201, max: 225 },
  NOTIFICATION: { min: 176, max: 200 },
  PLATFORM: { min: 151, max: 175 },
  PERSONALITY: { min: 126, max: 150 },
  PRONOUN: { min: 101, max: 125 },
  REGION: { min: 51, max: 100 },
  EVERYONE: { min: 1, max: 50 },
} as const;

export type RoleBandKey = keyof typeof ROLE_BANDS;

/** Default positions for all roles created during server setup */
export const DEFAULT_ROLE_POSITIONS: Record<string, number> = {
  // Core roles
  '@everyone': 1,
  Member: 600,
  Moderator: 800,
  Admin: 900,

  // Color Roles (226–275)
  Red: 226,
  Blue: 227,
  Green: 228,
  Purple: 229,
  Yellow: 230,
  Orange: 231,
  White: 232,
  Black: 233,

  // Pronoun Roles (101–125)
  'He/Him': 101,
  'She/Her': 102,
  'They/Them': 103,
  'Any Pronouns': 104,
  'Ask Me': 105,

  // Notification Roles (176–200)
  Announcements: 176,
  Events: 177,
  Updates: 178,
  'Game Nights': 179,
  'Voice Events': 180,

  // Region Roles (51–100)
  Canada: 51,
  USA: 52,
  'United Kingdom': 53,
  Germany: 54,
  France: 55,
  Spain: 56,
  Italy: 57,
  Netherlands: 58,
  Sweden: 59,
  Norway: 60,
  Denmark: 61,
  Finland: 62,
  Poland: 63,
  Brazil: 64,
  Mexico: 65,
  Japan: 66,
  'South Korea': 67,
  China: 68,
  India: 69,
  Australia: 70,
  'New Zealand': 71,
  'South Africa': 72,
  Other: 73,

  // Platform Roles (151–175)
  PC: 151,
  PlayStation: 152,
  Xbox: 153,
  Mobile: 154,
  VR: 155,
  Nintendo: 156,

  // Server Access Roles (201–225)
  '18+ Content': 201,
  'Bot Commands': 202,

  // Personality Roles (126–150)
  Lurker: 126,
  Talkative: 127,
  Chaos: 128,
  'Big Brain': 129,
  'Goblin Mode': 130,
};

/** Maps role reaction group names to their band key */
export const GROUP_NAME_TO_BAND: Record<string, RoleBandKey> = {
  'Color Roles': 'COLOR',
  'Pronoun Roles': 'PRONOUN',
  'Notification Roles': 'NOTIFICATION',
  'Region Roles': 'REGION',
  'Platform Roles': 'PLATFORM',
  'Server Access Roles': 'SERVER_ACCESS',
  'Personality Roles': 'PERSONALITY',
};

/**
 * Find the lowest unused position within a band.
 * Returns null if the band is full.
 */
export function getNextAvailablePosition(
  bandKey: RoleBandKey,
  existingPositions: Set<number> | number[],
): number | null {
  const band = ROLE_BANDS[bandKey];
  const posSet = existingPositions instanceof Set ? existingPositions : new Set(existingPositions);
  for (let pos = band.min; pos <= band.max; pos++) {
    if (!posSet.has(pos)) return pos;
  }
  return null;
}

/**
 * Get the band key for a given position, or null if it falls in no band.
 */
export function getBandForPosition(position: number): RoleBandKey | null {
  for (const [key, band] of Object.entries(ROLE_BANDS)) {
    if (position >= band.min && position <= band.max) return key as RoleBandKey;
  }
  return null;
}
