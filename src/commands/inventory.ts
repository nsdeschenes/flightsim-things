import aircraft from './aircraft.ts';
import airlines from './airlines.ts';
import airports from './airports.ts';
import interactiveList from './interactive-list.ts';
import liveries from './liveries.ts';

const inventory = {
  commands: {
    aircraft: aircraft.command,
    airlines: airlines.command,
    airports: airports.command,
    liveries: liveries.command,
  },
  loaders: new Map([
    ['aircraft list', aircraft.savedList],
    ['airlines list', airlines.savedList],
    ['airports list', airports.savedList],
    ['liveries list', liveries.savedList],
  ]),
  prepare: interactiveList.prepare,
};

export default inventory;
