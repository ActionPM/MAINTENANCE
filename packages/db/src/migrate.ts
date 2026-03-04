import { createPool } from './pool.js';

/**
 * Run all migrations in order.
 * Each migration is idempotent (IF NOT EXISTS).
 * Usage: DATABASE_URL=... pnpm --filter @wo-agent/db migrate
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Dynamically import all migration files
    const migrations = await loadMigrations();

    for (const migration of migrations) {
      const exists = await pool.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [migration.name],
      );
      if (exists.rows.length > 0) continue;

      await pool.query('BEGIN');
      try {
        await pool.query(migration.sql);
        await pool.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [migration.name],
        );
        await pool.query('COMMIT');
        console.log(`  applied: ${migration.name}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await pool.end();
  }
}

interface Migration {
  name: string;
  sql: string;
}

async function loadMigrations(): Promise<Migration[]> {
  // Migrations are co-located as .sql files, loaded in alphabetical order
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(import.meta.dirname, 'migrations');
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf-8');
    migrations.push({ name: file.replace('.sql', ''), sql });
  }
  return migrations;
}

// CLI entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations complete'))
    .catch((err) => { console.error(err); process.exit(1); });
}
