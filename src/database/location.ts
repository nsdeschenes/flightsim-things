import {homedir} from 'node:os';
import path from 'node:path';

const directory = path.join(homedir(), '.flightsim-things');
const databaseFile = path.join(directory, 'addons.sqlite');
const location = {databaseFile, directory};

export default location;
