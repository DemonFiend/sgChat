import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sql } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getMigrationsDir(): string {
  const candidates = [
    join(__dirname, '..', 'migrations'), // from dist/lib/ → dist/migrations/
    join(__dirname, '..', '..', 'src', 'migrations'), // from dist/lib/ → src/migrations/
  ];
  for (const dir of candidates) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      /* continue */
    }
  }
  throw new Error('Migrations directory not found');
}

export async function runMigrations(): Promise<void> {
  // Ensure _migrations table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Get already-applied migrations
  const applied = await sql`SELECT name FROM _migrations`;
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read migration files sorted alphanumerically
  const migrationsDir = getMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const name = file.replace('.sql', '');
    if (appliedSet.has(name)) continue;

    const filePath = join(migrationsDir, file);
    const content = readFileSync(filePath, 'utf-8');

    try {
      await sql.begin(async (tx: any) => {
        await tx.unsafe(content);
        await tx`INSERT INTO _migrations (name) VALUES (${name}) ON CONFLICT DO NOTHING`;
      });
      count++;
      console.log(`  ✅ Applied migration: ${name}`);
    } catch (error) {
      console.error(`❌ Migration failed: ${name}`, error);
      process.exit(1);
    }
  }

  if (count === 0) {
    console.log('✅ Migrations up to date');
  } else {
    console.log(`✅ Applied ${count} migration(s)`);
  }
}
