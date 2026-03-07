import fs from 'fs';
import path from 'path';
import type { DefaultPackCategory } from '@sgchat/shared';

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
