import {Console, Effect} from 'effect';
import {Command} from 'effect/cli';

import airportEnrichment from '#airport-enrichment';
import database from '#database';
import schema from '#database-schema';

type Airport = typeof schema.airports.$inferSelect;

const columns: readonly Readonly<{header: string; key: keyof Airport}>[] = [
  {header: 'ID', key: 'id'},
  {header: 'ICAO code', key: 'icaoCode'},
  {header: 'IATA code', key: 'iataCode'},
  {header: 'Name', key: 'name'},
  {header: 'Latitude', key: 'latitude'},
  {header: 'Longitude', key: 'longitude'},
  {header: 'Elevation meters', key: 'elevationMeters'},
  {header: 'Package ID', key: 'packageId'},
  {header: 'Source key', key: 'sourceKey'},
];
const cellPadding = 2;
const firstRowIndex = 0;
const headerRowCount = 1;
const noAirports = 0;
const controlCharacters = /\p{Cc}/gu;

function formatAirports(airports: readonly Readonly<Airport>[]): string {
  const tableColumns: readonly Readonly<{cells: readonly string[]; width: number}>[] =
    columns.map(column => {
      const cells = [
        column.header,
        ...airports.map(airport =>
          Bun.stripANSI(String(airport[column.key] ?? '')).replaceAll(
            controlCharacters,
            ' '
          )
        ),
      ];
      let width = Bun.stringWidth(column.header);
      for (const cell of cells) {
        width = Math.max(width, Bun.stringWidth(cell));
      }

      return {cells, width};
    });
  const border = `+${tableColumns.map(column => '-'.repeat(column.width + cellPadding)).join('+')}+`;
  const lines = Array.from(
    {length: airports.length + headerRowCount},
    (_value, rowIndex) => {
      const line = `| ${tableColumns
        .map(column => {
          const cell = column.cells[rowIndex] ?? '';
          return cell + ' '.repeat(column.width - Bun.stringWidth(cell));
        })
        .join(' | ')} |`;
      if (rowIndex === firstRowIndex) {
        return `${line}\n${border}`;
      }

      return line;
    }
  );
  return [border, ...lines, border].join('\n');
}

const listCommand = Command.make('list', {}, () =>
  Effect.gen(function* listAirports() {
    const airports = yield* database.use(db =>
      db
        .select()
        .from(schema.airports)
        .orderBy(schema.airports.icaoCode, schema.airports.name, schema.airports.id)
        .all()
    );
    if (airports.length === noAirports) {
      return yield* Console.log(
        'No installed airports found. Run scan to populate the list.'
      );
    }

    return yield* Console.log(formatAirports(airports));
  })
).pipe(Command.withDescription('List installed airports from the saved addon database'));

const enrichCommand = Command.make('enrich', {}, () =>
  Effect.gen(function* enrichAirports() {
    const summary = yield* airportEnrichment.enrich();
    yield* Console.log(
      `Enriched ${summary.enriched} of ${summary.airports} airports. ${summary.unmatched} unmatched, ${summary.ambiguous} ambiguous, ${summary.skipped} skipped.`
    );
  })
).pipe(Command.withDescription('Enrich installed airport metadata from OpenAIP'));

const airportsCommand = Command.make('airports').pipe(
  Command.withDescription('Manage installed airport metadata'),
  Command.withSubcommands([listCommand, enrichCommand])
);

export default airportsCommand;
