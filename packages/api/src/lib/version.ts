import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadVersion(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'package.json'), // from dist/lib/
    join(__dirname, '..', '..', '..', 'package.json'), // from src/lib/
    '/app/package.json', // Docker
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf-8'));
      if (pkg.name === 'sgchat') return pkg.version;
    } catch {
      /* continue */
    }
  }
  return '0.0.0';
}

export const APP_VERSION = loadVersion();
