# flightsim-things

CLI tools for scanning Microsoft Flight Simulator 2024 addons and enriching airport metadata with OpenAIP.

## Getting Started

Install [Bun](https://bun.com), then run:

```bash
bun install
bun run start --help
```

Release executables are available from GitHub Releases for Windows x64, macOS arm64,
Linux x64, and Linux arm64. They include the runtime. On macOS and Linux, run
`chmod +x <executable>` first, then use the executable in place of `bun run start`.

## Scan Addons

Save your Community directory and scan its packages:

```bash
bun run start community-path set '/Games/MSFS 2024/Community'
bun run start scan
```

The directory must exist. Relative paths and quoted `~` paths are supported.
Use `community-path get` to see the saved path or `community-path update <path>` to change it.

Scans save package, aircraft, livery, airport, and airline metadata locally.
Malformed packages are skipped and cause a nonzero exit status; fix the reported errors
and scan again. Repeated scans update existing records but retain records for removed addons.

Airport detection requires explicit airport XML or `AirportServices` entries.
Compiled BGL scenery is not decoded, so airport coverage may be incomplete.

## List Airports

Show saved airport metadata in an ASCII table:

```bash
bun run start airports list
```

Find an airport by its exact ICAO or IATA code, ignoring case:

```bash
bun run start airports list --code KJFK
```

The table includes every airport database column and the package directory.
Missing values are blank. Directories are clickable in terminals that support links.
Use `--hyperlink always` to force links or `--hyperlink never` to disable them.
The default, `--hyperlink auto`, uses links only in interactive terminals whose
`TERM` is not `dumb`. Piped output stays plain text.
Rows are sorted by ICAO code, name, and ID, with missing codes and names first.
This command reads the saved inventory without scanning or fetching metadata.

## List Aircraft

Show saved aircraft metadata, or filter by aircraft ICAO type designator and airline ICAO code:

```bash
bun run start aircraft list
bun run start aircraft list --code A320
bun run start aircraft list --airline BAW
bun run start aircraft list --code A320 --airline BAW
```

Both filters match exact codes, ignore case, and trim surrounding whitespace.
Together they require both matches. Airline matches require a livery linked to the
aircraft and airline in the saved inventory. Unresolved livery links do not match.
Each aircraft record appears once, even with multiple matching liveries.
The table includes every aircraft database column and the aircraft package directory.
Missing values are blank. Rows are sorted by ICAO type designator, name, and ID.
Use `--hyperlink auto`, `always`, or `never` as with `airports list`.
Run `scan` first to populate the saved inventory.

## Enrich Airports

Create an API client at [OpenAIP](https://www.openaip.net/) and copy its API key, then run:

```bash
bun run start openaip-key set 'your-api-key'
bun run start airports enrich
```

Run `scan` first. Enrichment adds airport names, codes, coordinates, and elevations
using exact ICAO or IATA matches. Unmatched or ambiguous airports stay unchanged.
The command reports enriched, unmatched, ambiguous, and skipped counts.
If any lookup fails, no airport updates are saved.

## Configure AI

Save an OpenAI, Anthropic, or Google provider, model ID, and API key:

```bash
bun run start ai set --provider openai --model 'your-model-id' --api-key 'your-api-key'
bun run start ai get
```

Use `openai`, `anthropic`, or `google` for the provider. All three flags are required
when you save or replace the configuration. `ai get` masks the API key.
Configuration commands make no AI requests. SDK consumers can use `ai.model()` from
`#ai` to resolve the saved model with its configured key.

## Optional Telemetry

Telemetry is disabled until you configure Sentry:

```bash
bun run start sentry set --dsn 'https://publickey@o0.ingest.sentry.io/123456' \
  --errors 1 --logs 0 --metrics 0 --traces 0
```

Sample rates range from `0` (off) to `1` (all events).
Use `sentry update` to change selected values or `sentry get` to view the configuration.
Help, version, argument errors, and Sentry, OpenAIP key, and AI configuration commands do not send telemetry.
With Sentry tracing enabled, AI SDK calls record model and token usage, prompts,
and generated outputs through the Vercel AI integration.

## Local Data

Files are stored in `~/.flightsim-things/`:

- `config.json`: Community path, OpenAIP API key, AI provider settings, and Sentry settings, saved with private file permissions.
- `addons.sqlite`: scanned addon metadata and enriched airports.

API keys are stored as plaintext in `config.json`. AI keys are redacted in runtime
configuration values and in `ai get` output.

## Development

```bash
bun run test
bun run test:source
bun run test:acceptance
bun run typecheck
bun run lint
bun run fmt:check
```

`bun run test` runs both suites. Source tests live beside their modules in `src/`
and include unit, component, and adapter integration tests. Acceptance tests in
`acceptance/` exercise the application CLI and release tooling through subprocesses.
Bare `bun test` runs only the source suite.

Run one acceptance file with `bun run test:acceptance ./commands/ai.test.ts`.
Set `FLIGHTSIM_TEST_BINARY` to an absolute or repository-relative executable path
to run application acceptance against a compiled binary. Release-tool tests keep
using `scripts/release.ts`.

CI runs lint, typecheck, and formatting first. Once all three pass, source and
acceptance tests run in separate parallel jobs using the shared dependency artifact.
The final `test` check requires both suites to succeed.

`bun install` patches the TypeScript compiler with Effect diagnostics, which run during
`typecheck`. Use `bun run effect:diagnostics` to run them separately.

After changing database tables, run `bun run db:generate` and review the generated SQL.

- [Addon database schema and usage](docs/addon-database.md)
- [Building executables and publishing releases](docs/releases.md)
