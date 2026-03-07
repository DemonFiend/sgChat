import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { DefaultPackCategory } from '@sgchat/shared';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { storage } from '../lib/storage.js';
import { processEmoji } from '../lib/emojiProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_EXTENSIONS = ['.png', '.gif', '.jpg', '.jpeg', '.webp'];

let cachedDataDir: string | null = null;
let cachedCatalog: DefaultPackCategory[] | null = null;

function getDataDir(): string | null {
  if (cachedDataDir !== null) return cachedDataDir || null;

  const candidates = [
    path.resolve(__dirname, '../data/default-emoji-packs'), // from dist/services/ -> dist/data/
    path.resolve(__dirname, '../../data/default-emoji-packs'), // from dist/services/ -> data/
    path.resolve(__dirname, '../../../data/default-emoji-packs'), // from src/services/ -> data/
    path.resolve(process.cwd(), 'data/default-emoji-packs'), // from packages/api/
    path.resolve(process.cwd(), 'dist/data/default-emoji-packs'), // from packages/api/ dist
    '/app/packages/api/dist/data/default-emoji-packs', // Docker dist
    '/app/packages/api/data/default-emoji-packs', // Docker source
  ];

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) {
        cachedDataDir = dir;
        console.log('[DefaultEmojiPacks] Found data dir:', dir);
        return dir;
      }
    } catch {
      // skip inaccessible paths
    }
  }

  console.log('[DefaultEmojiPacks] No data dir found. Checked:', candidates);
  cachedDataDir = ''; // empty string = not found, but cached
  return null;
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

export function scanDefaultPacks(): DefaultPackCategory[] {
  if (cachedCatalog) return cachedCatalog;

  const dataDir = getDataDir();
  if (!dataDir) {
    cachedCatalog = [];
    return [];
  }

  try {
    const categories: DefaultPackCategory[] = [];

    const categoryDirs = fs.readdirSync(dataDir, { withFileTypes: true });
    for (const catEntry of categoryDirs) {
      if (!catEntry.isDirectory()) continue;

      const categoryName = catEntry.name;
      const categoryPath = path.join(dataDir, categoryName);
      const packs: DefaultPackCategory['packs'] = [];

      const packDirs = fs.readdirSync(categoryPath, { withFileTypes: true });
      for (const packEntry of packDirs) {
        if (!packEntry.isDirectory()) continue;

        const packName = packEntry.name;
        const packPath = path.join(categoryPath, packName);
        const files = fs.readdirSync(packPath).filter(isImageFile);

        if (files.length === 0) continue;

        packs.push({
          key: `${categoryName}/${packName}`,
          category: categoryName,
          name: packName,
          emojiCount: files.length,
          installed: false,
        });
      }

      if (packs.length > 0) {
        categories.push({ name: categoryName, packs });
      }
    }

    cachedCatalog = categories;
    return categories;
  } catch (err) {
    console.error('[DefaultEmojiPacks] Error scanning packs:', err);
    cachedCatalog = [];
    return [];
  }
}

export function getPackImageFiles(key: string): { filename: string; filepath: string }[] {
  const dataDir = getDataDir();
  if (!dataDir) return [];

  const packPath = path.join(dataDir, key);
  if (!fs.existsSync(packPath)) return [];

  return fs
    .readdirSync(packPath)
    .filter(isImageFile)
    .map((filename) => ({
      filename,
      filepath: path.join(packPath, filename),
    }));
}

export function readPackImage(filepath: string): Buffer {
  return fs.readFileSync(filepath);
}

export function invalidateCache(): void {
  cachedCatalog = null;
}

/**
 * Simplify a filename into a clean shortcode by stripping numeric prefixes.
 * e.g., "839220-happycatemoji.png" → "happycatemoji"
 *       "4731-verified-red.gif" → "verified_red"
 *       "112626-26.png" → "26"
 */
function simplifyFilename(filename: string): string {
  let name = filename.replace(/\.[^/.]+$/, ''); // strip extension
  name = name.replace(/^\d+[-_]/, ''); // strip leading numeric prefix
  name = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
  return name;
}

/**
 * Find a unique shortcode by appending sequential suffixes (_01, _02, etc.)
 */
async function resolveShortcode(
  base: string,
  serverId: string,
  usedInBatch: Set<string>,
): Promise<string> {
  if (!usedInBatch.has(base)) {
    const existing = await db.emojis.findByShortcode(serverId, base);
    if (!existing) return base;
  }
  for (let i = 1; i < 100; i++) {
    const candidate = `${base}_${String(i).padStart(2, '0')}`;
    if (!usedInBatch.has(candidate)) {
      const existing = await db.emojis.findByShortcode(serverId, candidate);
      if (!existing) return candidate;
    }
  }
  return `${base}_${nanoid(4)}`;
}

/**
 * Install a single default pack into a server.
 * Returns the result or null if already installed / not found.
 */
export async function installDefaultPack(
  serverId: string,
  key: string,
  userId: string,
): Promise<{ packId: string; importedCount: number; errors: string[] } | null> {
  const imageFiles = getPackImageFiles(key);
  if (imageFiles.length === 0) return null;

  // Check if already installed
  const existing = await db.emojiPacks.findByDefaultKey(serverId, key);
  if (existing) return null;

  const packName = key.split('/')[1];
  const pack = await db.emojiPacks.create({
    server_id: serverId,
    name: packName,
    created_by_user_id: userId,
    source: 'default',
    default_pack_key: key,
  });

  let importedCount = 0;
  const errors: string[] = [];
  const usedInBatch = new Set<string>();

  for (const { filename, filepath } of imageFiles) {
    try {
      const buffer = readPackImage(filepath);
      const processed = await processEmoji(buffer);

      let shortcode = simplifyFilename(filename);

      // For default packs: short names (< 2 chars) get dual shortcodes
      // e.g., "3" → primary ":03:", alias ":num_3:"
      let aliasShortcode: string | null = null;
      if (shortcode.length < 2) {
        const padded = shortcode.padStart(2, '0');
        const prefixed = `${packName.replace(/[^a-z0-9]/gi, '').slice(0, 3).toLowerCase()}_${shortcode}`;
        shortcode = padded;
        aliasShortcode = prefixed.length >= 2 ? prefixed : null;
      }

      shortcode = await resolveShortcode(shortcode, serverId, usedInBatch);
      usedInBatch.add(shortcode);

      const ext = processed.content_type === 'image/gif' ? 'gif' : 'webp';
      const assetKey = `emojis/${serverId}/${nanoid(12)}.${ext}`;
      await storage.uploadFile(processed.buffer, assetKey, processed.content_type);

      await db.emojis.create({
        server_id: serverId,
        pack_id: pack.id,
        shortcode,
        content_type: processed.content_type,
        is_animated: processed.is_animated,
        width: processed.width,
        height: processed.height,
        size_bytes: processed.size_bytes,
        asset_key: assetKey,
        created_by_user_id: userId,
      });
      importedCount++;

      // Create alias shortcode for short names (same asset, different shortcode)
      if (aliasShortcode) {
        const resolvedAlias = await resolveShortcode(aliasShortcode, serverId, usedInBatch);
        usedInBatch.add(resolvedAlias);
        await db.emojis.create({
          server_id: serverId,
          pack_id: pack.id,
          shortcode: resolvedAlias,
          content_type: processed.content_type,
          is_animated: processed.is_animated,
          width: processed.width,
          height: processed.height,
          size_bytes: processed.size_bytes,
          asset_key: assetKey,
          created_by_user_id: userId,
        });
        importedCount++;
      }
    } catch (err: any) {
      errors.push(`${filename}: ${err.message}`);
    }
  }

  return { packId: pack.id, importedCount, errors };
}

/**
 * Auto-install all default packs that aren't already installed in a server.
 * Called at startup from bootstrap.
 */
export async function installAllDefaultPacks(
  serverId: string,
  userId: string,
): Promise<void> {
  const categories = scanDefaultPacks();
  if (categories.length === 0) return;

  let totalInstalled = 0;

  for (const cat of categories) {
    for (const pack of cat.packs) {
      try {
        const result = await installDefaultPack(serverId, pack.key, userId);
        if (result) {
          console.log(
            `[DefaultEmojiPacks] Auto-installed "${pack.name}" (${result.importedCount} emojis)`,
          );
          if (result.errors.length > 0) {
            console.warn(`[DefaultEmojiPacks] Errors in "${pack.name}":`, result.errors);
          }
          totalInstalled++;
        }
      } catch (err) {
        console.error(`[DefaultEmojiPacks] Failed to auto-install "${pack.key}":`, err);
      }
    }
  }

  if (totalInstalled > 0) {
    console.log(`[DefaultEmojiPacks] Auto-installed ${totalInstalled} packs total`);
  }
}
