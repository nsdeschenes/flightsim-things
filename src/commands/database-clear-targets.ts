import schema from '#database-schema';

const clearTables = [
  {name: 'aircraft', table: schema.aircraft},
  {name: 'airlines', table: schema.airlines},
  {name: 'airports', table: schema.airports},
  {name: 'liveries', table: schema.liveries},
  {name: 'packages', table: schema.packages},
] as const;

export default clearTables;
