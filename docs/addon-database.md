# Addon database

## Problem

Store general MSFS 2024 addon metadata in `~/.flightsim-things/addons.sqlite`.
An installed package can supply several aircraft, airports, and liveries. A standalone
livery can refer to an aircraft in another package, including one we have not recorded.
The initial metadata sources do not establish every name, code, or relationship.

The existing Bun CLI uses Effect 4, stores preferences in `config.json`, and ships
compiled executables. Database acquisition belongs to addon operations. Existing
commands continue to acquire only the resources they use.

## Usage

Import the database boundary and schema from their default exports. Validate external
values with the generated Effect schemas, then run synchronous Drizzle queries:

```ts
import path from 'node:path';

import {Effect, Schema} from 'effect';

import database from './src/database/index.ts';
import schema from './src/database/schema.ts';

const savePackage = Effect.gen(function* () {
  const input = yield* Schema.decodeUnknownEffect(schema.insert.packages)({
    sourcePath: path.resolve('/Games/Community/example-aircraft'),
    title: 'Example aircraft',
    version: '1.0.0',
    contentType: 'AIRCRAFT',
  });
  return yield* database.use(db =>
    db
      .insert(schema.packages)
      .values(input)
      .onConflictDoUpdate({
        target: schema.packages.sourcePath,
        set: {title: input.title, version: input.version},
      })
      .returning()
      .get()
  );
});
```

An upsert keeps the package ID stable. Apply the same pattern to child records using
their `(packageId, sourceKey)` unique keys. Update aircraft rows in place: deleting and
reinserting them would clear links from liveries in other packages.

```ts
const listPackages = Effect.gen(function* () {
  const rows = yield* database.use(db => db.select().from(schema.packages).all());
  return yield* Schema.decodeUnknownEffect(Schema.Array(schema.select.packages))(rows);
});

const packageContents = database.use(db =>
  db.query.packages
    .findMany({
      with: {aircraft: true, airports: true, liveries: true},
    })
    .sync()
);

const liveryDetails = database.use(db =>
  db.query.liveries
    .findFirst({
      where: {sourceKey: 'example-livery'},
      with: {
        aircraft: {with: {package: true}},
        airline: true,
        package: true,
      },
    })
    .sync()
);
```

Callbacks finish synchronously. Call `.all()`, `.get()`, or `.run()` for SQL builders.
Call `.sync()` for relational queries from `db.query`.
The database rejects a returned Promise, Effect, or unexecuted query. Keep handles and prepared
queries inside the callback. SQLite throws roll back synchronous Drizzle transactions
and become typed `database.Error` failures.

Validate inputs before calling `database.use`. Wrap related writes in
`db.transaction(callback, {behavior: 'immediate'})` and return materialized rows from
the transaction callback.

## Shape

| Table      | General fields                                                            | Identity and relationships                                |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages` | Title, creator, manufacturer, version, content type, minimum game version | Unique normalized absolute source directory               |
| `aircraft` | Name, manufacturer, model, ICAO type designator                           | Belongs to a package; unique source key within it         |
| `airports` | Name, ICAO and IATA codes, elevation, latitude, longitude                 | Belongs to a package; unique source key within it         |
| `airlines` | Name, ICAO and IATA codes                                                 | Shared by liveries; known codes are unique, names are not |
| `liveries` | Name, registration, observed aircraft target key                          | Belongs to a package; optional aircraft and airline links |

All rows have generated integer IDs. Display metadata is nullable: `null` means unknown.
Airport `elevationMeters` uses meters and maps to the SQLite `elevation_meters` column.
Airport `latitude` and `longitude` use WGS84 decimal degrees. All three fields use
nullable SQLite `REAL` columns, where `null` means unknown. The scanner leaves these
fields unknown on insertion and preserves stored values when rescanning an airport.
Source keys identify observed entities, such as a SimObject container path, a variation
within a configuration file, or an airport within a scenery source. They are stable
locators, independent of display names. Normalize package directories with `path.resolve`
and source keys to a consistent package-relative representation before writing.

Aircraft designators and airport codes are indexed or stored observations, not global
entity identities. Several developers can supply the same aircraft type or airport.
An airline may have only a name or only a code; a row with no known identifying field
is rejected by SQLite. Normalize blank metadata to null and known codes to uppercase.
Do not merge airlines by display name or invent a code from a package title.

`liveries.aircraftId` may target an aircraft from any package. `targetAircraftKey` retains
an observed reference while the target is unresolved, and can remain after resolution.
Generic or private liveries do not require an airline. Deleting a package cascades to its
aircraft, airports, and liveries. Deleting an aircraft or airline clears references from
surviving liveries; observed target keys remain available for later resolution.

Types derive from the declarations and generated schemas:

```ts
type Package = typeof schema.packages.$inferSelect;
type NewPackage = typeof schema.insert.packages.Type;
type Livery = typeof schema.liveries.$inferSelect;
```

`src/database/tables/` owns table definitions, one default table export per file so
Drizzle Kit can discover them while honoring the repository's default-export rules.
`schema.ts` exposes these tables, generated validators, and the RC `defineRelations`
graph. Required child package links use `optional: false`. Livery aircraft and airline
links remain nullable. Inverse collection links use Drizzle's relation inference.
`index.ts` owns the resource scope, connection settings, migration lock,
and error mapping. `drizzle/` contains the canonical migration history.
`location.ts` computes the database file and migration directory paths.

The client receives `drizzle({client, relations: schema.relations})`. Its type retains
the concrete relation graph, so `with` fields and nested result types follow that graph.
The callback exposes readonly query methods and hides mutable client metadata and the
raw SQLite handle. This avoids recursively mapping the relation graph through a
readonly class type.
An absent `findFirst` result is undefined. An absent optional one relation is null.
An empty many relation is an empty array.

Drizzle's [RC relations API](https://orm.drizzle.team/docs/relations) describes nested
queries. SQLite foreign keys continue to enforce storage integrity. Relation definitions
do not require SQL migrations.

The small `database.use` interface hides lifecycle and migration policy. Tables and
Drizzle queries remain an intentional infrastructure interface. `src/scanner/` owns
metadata interpretation and transactional upserts.

## Initial source mapping

| Source                                                                                   | Stored result                                                                      |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Package directory                                                                        | `packages.sourcePath`; normalize its absolute path                                 |
| `manifest.json`: `title`, `creator`, `manufacturer`                                      | Matching package columns                                                           |
| `manifest.json`: `package_version`, `content_type`, `minimum_game_version`               | `version`, `contentType`, `minimumGameVersion`                                     |
| `layout.json`: indexed paths                                                             | Discover relevant metadata files and source locators; discard the full inventory   |
| `aircraft.cfg`: `GENERAL` and `FLTSIM.n` sections                                        | Aircraft metadata, livery names, registrations, and explicit ICAO airline codes    |
| `aircraft.cfg`: `LIVERY.base_container` or `VARIATION.base_container`                    | Normalized virtual aircraft target, resolved after all package batches             |
| `livery.cfg`: `GENERAL.name` and optional `FLTSIM.n` overrides                           | One livery per file, with explicit airline code and registration where known       |
| `FSData` XML: `Airport` elements with `ident`, `name`, and optional `iata`               | Airport names and explicit codes, keyed by source file and airport ident           |
| `AirportServices/<ICAO>/Services.xml` or `Services.spb`                                  | Explicit airport code; name and IATA code remain null                              |
| `vendor-airport-CODE-name` Community directory with BGL scenery and no explicit airports | One inferred four-character alphanumeric airport code; other metadata remains null |

Store the original content type string, including unfamiliar values. The manifest
content type controls which metadata the scanner imports. `AIRCRAFT` permits
aircraft and bundled liveries. `LIVERY` permits liveries, including legacy
`aircraft.cfg` variations. `SCENERY` permits airports, including package-name
fallback. Missing or unsupported content types produce no child records.
The scanner skips unrelated metadata files before parsing them.

The `scan` command reads the saved Community directory and imports this metadata.
The two JSON files alone cannot reliably supply airline identity or airport codes. Aircraft configuration provides
variation and airline fields, including `ui_variation` and `icao_airline`, according to
the [MSFS 2024 aircraft configuration documentation](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/aircraft_cfg.htm).
Leave unknown fields and links null. The package-directory convention below is the
only airport-code inference.

Native MSFS 2024 [`livery.cfg` files](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/CFG_Files/livery_cfg.htm)
define one livery per file. The scanner uses `GENERAL.name`, including when there
are no `FLTSIM.n` overrides. Optional override values are recorded when their explicit
values agree across sections. Missing or conflicting values remain null. The native
livery's aircraft target remains null because this file does not specify a base.
Legacy `aircraft.cfg` files with `LIVERY` or `VARIATION` sections create livery records,
and their missing base containers remain null rather than creating aircraft records.

The scanner discovers package directories, including package symlinks, without
materializing the Community tree. It holds at most 16 package snapshots per batch
and reads four packages concurrently. Snapshots contain metadata, not file payloads
such as textures or compiled scenery. Individual metadata files and package layouts
are read in full, so this bounds package concurrency rather than total bytes.
One synchronous immediate transaction upserts each batch. Child inserts use chunks
of 100 rows to stay below SQLite parameter limits. IDs and unique source keys survive
repeated scans, and records are not deleted when sources disappear.
A successfully read package removes stored child records that its current manifest
content type does not permit. Allowed records retain their IDs and enriched data.
Package-name fallback airports are the exception. Each has the reserved source key
`#package-name-airport`. A successfully read package retires that row when fallback
eligibility disappears or explicit airport metadata becomes available. A same-code
explicit observation promotes the fallback row to its explicit source key, preserving
its ID, coordinates, and elevation when that source key does not already exist.
Explicit names and IATA codes replace stored values, including null values. Ordinary
explicit rows remain stored when their sources disappear and prevent later scans
from inserting package-name fallback airports for that package. Stored explicit
rows also retire any coexisting fallback row. Failed packages retain their existing rows.
An interrupted scan preserves existing livery links when their observed targets
are unchanged. Changed or removed targets clear their links during the batch update.

After all batches, the scanner resolves observed livery targets against observed
aircraft using an indexed temporary table. An exact match in the livery's package
takes precedence. A match in another scanned package must be unique. Stored aircraft
from another Community directory, failed packages, or absent source entries do not
participate. Missing or ambiguous targets remain null.

Layout paths must remain within their package. Internal metadata symlinks cannot
escape the package, although the package directory itself can be a symlink.
These checks cover static paths. They do not guarantee containment during
concurrent replacement of source files or directories.
Malformed XML with a recognizable unrelated root produces a warning without
rejecting other package metadata. Airport XML, airport-specific Services XML,
and XML with an uncertain root remain strict.
Each malformed package produces a contextual stderr message and is skipped.
The command continues valid packages and returns a nonzero status when any package
fails. Database and Community directory errors stop the scan.

Compiled BGL scenery is not decoded. After all explicit metadata parses successfully,
a package with BGL entries and no explicit airports can supply one inferred airport
from its Community directory basename. The anchored convention is
`vendor-airport-CODE-name`, with exactly four alphanumeric code characters and nonempty
vendor and name segments containing letters, digits, and hyphens. Vendor names can
contain hyphens. Package symlinks use the Community alias name. Codes are uppercased;
names, IATA codes, and locations remain null until enrichment. Manifest titles do not
supply codes. Explicit airports always take precedence, and corrupt airport metadata
still fails the package even when the directory name matches.

Every package containing BGL entries contributes one limitation warning, including
packages with an explicit or inferred airport. Airport coverage may still be incomplete.
The default scan prints the first five warning details across all batches, followed
by the exact omitted count. `scan --verbose` prints every detail. Both modes count
every warning and print every package failure.

## Persistence and migrations

The runtime uses `bun:sqlite` through `drizzle-orm/bun-sqlite`, with foreign keys, WAL,
and a five-second busy timeout. `Effect.acquireRelease` closes each connection even
when initialization or a query fails. New user storage uses private directory/file
permissions. Settings remain in `~/.flightsim-things/config.json`.

ORM and Kit are pinned to `1.0.0-rc.4`. This version exports the requested
[`drizzle-orm/effect-schema`](https://orm.drizzle.team/docs/effect-schema) API and supports
the installed Effect 4. The stable `0.45.4` package lacks that export. The generator
derives row types and field validation; SQL foreign keys, uniqueness, and cross-column
checks enforce relational constraints separately.

After changing a table:

```sh
bun run db:generate
```

Review and commit the generated SQL and snapshot under `drizzle/`.
Applied migration files are immutable. Release builds embed the complete directory
with Bun's `compile.assets` option. There is no generated TypeScript journal to maintain.

During development, Drizzle reads the repository's migration directory relative to
the database module. Standalone executables read the embedded directory under
`import.meta.dir`, including when launched from an empty working directory.
Drizzle's Bun migrator applies the SQL and records it in `__drizzle_migrations`.

A separate `addons.sqlite.lock.sqlite` file coordinates database access with a
SQLite `BEGIN IMMEDIATE` transaction. That transaction covers migration history
validation, migrations, and the synchronous callback. It holds ownership during
long synchronous work and releases ownership when the connection closes or its
process exits. The coordination file persists so all processes lock the same file.
It contains no application records.

The pinned migrator reads history before opening its SQL transaction, so the main
database's busy timeout alone cannot protect concurrent initialization. A separate
connection also permits migrations and caller transactions on `addons.sqlite`.
SQLite describes these transaction boundaries in its
[transaction documentation](https://www.sqlite.org/lang_transaction.html).

Contended coordination attempts retry up to 100 times with 50-millisecond delays.
These asynchronous delays let other Effects in the same process continue while a
connection holds the lock.
Holding the lock through the callback prevents a newer executable from migrating
between an older executable's compatibility check and its queries. This serializes
`database.use` callbacks across processes. Keep callbacks short and do not nest them.
Unknown migration names cause an older executable to fail before running caller queries.
Releases still require only the executable, with no migration sidecar.

## Synthesis decision

Two independent designs and a separate judge used the configured GPT-6.1-Sol model;
the comparison had independent contexts but no model diversity. The package-owned
candidate became the base because manifest/layout evidence does not justify shared
aircraft or airport identities. The catalog-first candidate contributed the explicit
separation of observed facts from inferred identity, and the migration startup check.
Both candidates' complete-snapshot APIs were deferred because they would impose an
import ownership policy before a metadata writer exists.

The follow-up relations comparison selected a single graph in `schema.ts` over a
separate graph module. It retains the existing `database.use` interface and derives the
client type from the configured graph. Explicit one links supply the join columns for
inferred inverse collections. A separate runtime test checks nested reads through the
actual file database.

The implementation binds `createRelationsHelper(tables)` once and uses a parameter-free
`defineRelations` callback. This preserves the inferred graph without readonly callback
annotations widening its types. The graph still has one definition.

The synthesis adds shared airline rows for explicit names/codes and a nullable
cross-package livery aircraft link. It avoids automatic identity matching. Screening
against the architecture red flags found one storage owner, derived validators and
migration data, and a single public connection lifecycle.

## Tradeoffs and alternatives

- We accept duplicate aircraft and airport descriptions across packages in exchange for avoiding false identity merges.
- We accept null metadata and unresolved livery targets in exchange for preserving source uncertainty.
- We accept exposing synchronous Drizzle queries in exchange for a narrow foundation without speculative ingestion APIs.
- We accept a pinned release candidate in exchange for the requested Effect 4 schema support.
- Shared identity catalogs and package link tables would support canonical grouping, but introduce matching policy and additional tables before a reliable source exists.
- A JSON blob per package would reduce table count, but lose foreign keys and indexed airport/livery queries.

## Remaining limits

Package identity follows the absolute installation path. Moving a package creates a
new source identity. The scanner retains the old records until a future cleanup policy
is defined. Package-name inference can produce an incorrect airport code when the
directory convention is misleading. Compiled scenery decoding remains unimplemented.
