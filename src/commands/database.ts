import {Console, Effect} from 'effect';
import {Argument, Command} from 'effect/cli';
import {Literals as literalArgument} from 'effect/cli/Argument';

import database from '#database';
import schema from '#database-schema';

const clearTables = [
  {name: 'aircraft', table: schema.aircraft},
  {name: 'airlines', table: schema.airlines},
  {name: 'airports', table: schema.airports},
  {name: 'liveries', table: schema.liveries},
  {name: 'packages', table: schema.packages},
] as const;
const firstIndex = 0;
type TableName = (typeof clearTables)[number]['name'];
type ClearTarget = TableName | 'all';
type ClearOptions = Readonly<{target: ClearTarget}>;
type QueryDatabase = Parameters<
  Parameters<typeof database.use>[typeof firstIndex]
>[typeof firstIndex];
type Transaction = Readonly<
  Pick<
    Parameters<
      Parameters<QueryDatabase['transaction']>[typeof firstIndex]
    >[typeof firstIndex],
    'delete'
  >
>;
const targets = [
  ...clearTables.map((entry: Readonly<{name: TableName}>) => entry.name),
  'all',
] as const;
const targetDescription = `Record type to clear: ${targets.join(', ')}`;

function clearDatabase(
  target: ClearTarget
): Effect.Effect<void, InstanceType<typeof database.Error>> {
  return database.use(db => {
    db.transaction(
      (tx: Transaction) => {
        for (const entry of clearTables) {
          if (target === 'all' || target === entry.name) {
            tx.delete(entry.table).run();
          }
        }
      },
      {behavior: 'immediate'}
    );
  });
}

const clearCommand = Command.make(
  'clear',
  {
    target: literalArgument('target', targets).pipe(
      Argument.withDescription(targetDescription)
    ),
  },
  ({target}: ClearOptions) =>
    Effect.gen(function* clearSavedDatabase() {
      yield* clearDatabase(target);
      let description: string = target;
      if (target === 'all') {
        description = 'all records';
      }

      yield* Console.log(`Cleared ${description} from the saved addon database.`);
    })
).pipe(
  Command.withDescription(
    'Clear saved addon records. Clearing packages also removes aircraft, airports, and liveries. Clearing aircraft or airlines keeps liveries and removes their links. Settings and addon files are preserved.'
  )
);

const databaseCommand = Command.make('database').pipe(
  Command.withDescription('Manage the saved addon database'),
  Command.withSubcommands([clearCommand])
);

export default databaseCommand;
