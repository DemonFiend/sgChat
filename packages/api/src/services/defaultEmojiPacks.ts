import fs from 'fs';
import path from 'path';
import type { DefaultPackCategory } from '@sgchat/shared';

const IMAGE_EXTENSIONS = ['.png', '.gif', '.jpg', '.jpeg', '.webp'];

let cachedDataDir: string | null = null;
let cachedCatalog: DefaultPackCategory[] | null = null;

function getDataDir(): string | null {
  if (cachedDataDir !== null) return cachedDataDir;

  const candidates = [
    path.resolve(__dirname, '../../data/default-emoji-packs'), // from dist/services/
    path.resolve(__dirname, '../../../data/default-emoji-packs'), // from src/services/
    path.resolve(process.cwd(), 'data/default-emoji-packs'), // from packages/api/
    '/app/packages/api/data/default-emoji-packs', // Docker
    '/app/packages/api/dist/data/default-emoji-packs', // Docker dist
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      cachedDataDir = dir;
      return dir;
    }
  }

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
        installed: false, // populated by the route
      });
    }

    if (packs.length > 0) {
      categories.push({ name: categoryName, packs });
    }
  }

  cachedCatalog = categories;
  return categories;
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
