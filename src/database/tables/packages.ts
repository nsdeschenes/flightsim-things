import {integer, sqliteTable, text} from 'drizzle-orm/sqlite-core';

const packages = sqliteTable('packages', {
  contentType: text('content_type'),
  creator: text(),
  id: integer().primaryKey({autoIncrement: true}),
  manufacturer: text(),
  minimumGameVersion: text('minimum_game_version'),
  sourcePath: text('source_path').notNull().unique(),
  title: text(),
  version: text(),
});

export default packages;
