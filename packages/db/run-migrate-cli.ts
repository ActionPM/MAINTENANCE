import { runMigrations } from './src/migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
runMigrations(url)
  .then(() => console.log('Migrations complete'))
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
