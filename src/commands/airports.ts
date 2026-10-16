import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {eq, getColumns, or, sql} from 'drizzle-orm';
import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';
import {Literals as literalsFlag} from 'effect/cli/Flag';

import airportEnrichment from '#airport-enrichment';
import database from '#database';
import schema from '#database-schema';

type Airport = typeof schema.airports.$inferSelect &
  Pick<typeof schema.packages.$inferSelect, 'sourcePath'>;
type Cell = Readonly<{text: string; url?: string}>;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ListOptions = Readonly<{
  code: DeepReadonly<Option.Option<string>>;
  hyperlink: 'auto' | 'always' | 'never';
}>;

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
  {header: 'Directory', key: 'sourcePath'},
];
const cellPadding = 2;
const firstRowIndex = 0;
const headerRowCount = 1;
const noAirports = 0;
const controlCharacters = /\p{Cc}/gu;

function formatCell({text, url}: Cell, width: number): string {
  let content = text;
  if (typeof url === 'string') {
    content = `\u001B]8;;${url}\u001B\\${text}\u001B]8;;\u001B\\`;
  }

  return content + ' '.repeat(width - Bun.stringWidth(text));
}

function formatAirports(
  airports: readonly Readonly<Airport>[],
  hyperlinks: boolean
): string {
  const tableColumns: readonly Readonly<{cells: readonly Cell[]; width: number}>[] =
    columns.map(column => {
      const cells: readonly Cell[] = [
        {text: column.header},
        ...airports.map((airport): Cell => {
          const text = Bun.stripANSI(String(airport[column.key] ?? '')).replaceAll(
            controlCharacters,
            ' '
          );
          if (hyperlinks && column.key === 'sourcePath') {
            return {
              text,
              url: pathToFileURL(path.join(airport.sourcePath, path.sep)).href,
            };
          }

          return {text};
        }),
      ];
      let width = Bun.stringWidth(column.header);
      for (const cell of cells) {
        width = Math.max(width, Bun.stringWidth(cell.text));
      }

      return {cells, width};
    });
  const border = `+${tableColumns.map(column => '-'.repeat(column.width + cellPadding)).join('+')}+`;
  const lines = Array.from(
    {length: airports.length + headerRowCount},
    (_value, rowIndex) => {
      const line = `| ${tableColumns
        .map(column => formatCell(column.cells[rowIndex] ?? {text: ''}, column.width))
        .join(' | ')} |`;
      if (rowIndex === firstRowIndex) {
        return `${line}\n${border}`;
      }

      return line;
    }
  );
  return [border, ...lines, border].join('\n');
}

const listCommand = Command.make(
  'list',
  {
    code: Flag.String('code').pipe(
      Flag.withDescription('Match an exact ICAO or IATA code, ignoring case'),
      Flag.optional
    ),
    hyperlink: literalsFlag('hyperlink', ['auto', 'always', 'never']).pipe(
      Flag.withDescription('Link directories in terminal output: auto, always, or never'),
      Flag.withDefault('auto')
    ),
  },
  ({code, hyperlink}: ListOptions) =>
    Effect.gen(function* listAirports() {
      const airportCode = Option.map((value: string) => value.trim().toUpperCase())(code);
      const airports = yield* database.use(db =>
        db
          .select({
            ...getColumns(schema.airports),
            sourcePath: schema.packages.sourcePath,
          })
          .from(schema.airports)
          .innerJoin(schema.packages, eq(schema.airports.packageId, schema.packages.id))
          .where(
            airportCode.pipe(
              Option.map(value =>
                or(
                  eq(sql`upper(${schema.airports.icaoCode})`, value),
                  eq(sql`upper(${schema.airports.iataCode})`, value)
                )
              ),
              Option.getOrUndefined
            )
          )
          .orderBy(schema.airports.icaoCode, schema.airports.name, schema.airports.id)
          .all()
      );
      if (airports.length === noAirports) {
        if (Option.isSome(airportCode)) {
          return yield* Console.log('No installed airports match that code.');
        }

        return yield* Console.log(
          'No installed airports found. Run scan to populate the list.'
        );
      }

      const hyperlinks =
        hyperlink === 'always' ||
        (hyperlink === 'auto' && process.stdout.isTTY && process.env.TERM !== 'dumb');
      return yield* Console.log(formatAirports(airports, hyperlinks));
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
