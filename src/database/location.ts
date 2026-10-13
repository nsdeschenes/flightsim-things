import {homedir} from 'node:os';
import path from 'node:path';

const directory = path.join(homedir(), '.flightsim-things');
const databaseFile = path.join(directory, 'addons.sqlite');
let migrationsFolder = path.resolve(import.meta.dir, '../../drizzle');
if (Bun.isStandaloneExecutable) {
  migrationsFolder = path.join(import.meta.dir, 'drizzle');
}
const location = {databaseFile, directory, migrationsFolder};

export default location;
