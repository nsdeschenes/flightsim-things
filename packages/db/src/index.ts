import {connect} from '@tursodatabase/database';
import {defineRelations} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/tursodatabase/database';

import * as schema from './schema.js';

export async function openDatabase(path: string) {
  const client = await connect(path);
  return {
    db: drizzle({client, relations: defineRelations(schema)}),
    close: () => client.close(),
  };
}
