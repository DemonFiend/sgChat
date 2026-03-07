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

  for (const { filename, filepath } of imageFiles) {
    try {
      const buffer = readPackImage(filepath);
      const processed = await processEmoji(buffer);

      let shortcode = filename
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 32);
      if (shortcode.length < 2) shortcode = `emoji_${nanoid(4)}`;

      const existingEmoji = await db.emojis.findByShortcode(serverId, shortcode);
      if (existingEmoji) {
        shortcode = `${shortcode}_${nanoid(4)}`;
      }

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
