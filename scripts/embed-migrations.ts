import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

import {BunRuntime} from '@effect/platform-bun';
import {readMigrationFiles} from 'drizzle-orm/migrator';
import {Effect} from 'effect';

async function main(): Promise<void> {
  const journalFile = new URL('../src/database/migrations.ts', import.meta.url);
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  const entries = migrations.map(
    (
      migration: Readonly<{name: string; folderMillis: number; sql: readonly string[]}>
    ) => `  {
      name: ${JSON.stringify(migration.name)},
      sql: ${JSON.stringify(migration.sql.join('--> statement-breakpoint'))},
      timestamp: Date.parse(${JSON.stringify(new Date(migration.folderMillis).toISOString())}),
    }`
  );
  const contents = `import type {MigrationsJournal} from 'drizzle-orm/migrator';

const migrations: MigrationsJournal = [
${entries.join(',\n')},
];

export default migrations;
`;
  const formatted =
    await Bun.$`bunx oxfmt --stdin-filepath src/database/migrations.ts < ${new Blob([contents])}`.text();
  if (process.argv.includes('--check')) {
    if ((await readFile(journalFile, 'utf8')) !== formatted) {
      throw new Error('Embedded migrations are stale. Run bun run db:generate.');
    }
  } else {
    await writeFile(journalFile, formatted);
  }
}

BunRuntime.runMain(Effect.promise(main));
