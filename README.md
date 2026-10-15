# flightsim-things

To install dependencies:

```bash
bun install
```

To list commands:

```bash
bun run start -h
```

To print a greeting:

```bash
bun run start hello
```

To save your MSFS 2024 Community directory:

```bash
bun run start community-path set '/Games/MSFS 2024/Community'
```

To print the saved directory in a later session:

```bash
bun run start community-path get
```

To replace the saved directory:

```bash
bun run start community-path update '~/Games/MSFS 2024/Community'
```

`set` and `update` require an existing directory and print its absolute path.
Relative paths resolve against your current directory. Quote paths that contain spaces.
Both commands expand `~` and `~/` to your home directory, including inside quotes.
The CLI saves the path in `~/.flightsim-things/config.json`.
`get` prints the saved path even if you later remove that directory.
If no path is saved or the saved path is invalid, run `community-path set <path>`.

To scan the saved Community directory:

```bash
bun run start scan
```

`scan` saves package metadata, aircraft, livery variations, explicit airport metadata,
and airline codes in `~/.flightsim-things/addons.sqlite`. It reads packages in bounded
batches with four readers, then commits each batch in one transaction. Progress and
the final counts appear on stdout. Package errors and metadata warnings appear on stderr.
Malformed packages are skipped while valid packages are saved. Any failed package
causes a nonzero exit status. Fix the reported metadata and run `scan` again.

Repeated scans update existing rows and preserve their IDs. Scans retain records for
removed packages and entries. Livery links use explicit virtual aircraft containers.
Missing or ambiguous aircraft targets remain null.
Native MSFS 2024 `livery.cfg` files store one livery per file, including files without
`FLTSIM` overrides. Their aircraft targets remain null when no explicit base is known.

Airport records require explicit `FSData` airport XML or an
`AirportServices/<ICAO>/Services.xml` or `Services.spb` entry. Compiled scenery BGL files
are not decoded. Scenery packages are saved with a warning, so their airport records
can be incomplete. Unknown names and codes remain null.

## Save an OpenAIP API key

Sign in at [OpenAIP](https://www.openaip.net/), open **API clients**, create a client,
and copy its API key.
To save the key for the first time or replace a saved key:

```bash
bun run start openaip-key set 'your-api-key'
```

`set` prints `OpenAIP API key saved.` and saves the key as `openaipApiKey` in
`~/.flightsim-things/config.json` with private file permissions.
It preserves Community, Sentry, and other settings.
Provide the key exactly as copied, without whitespace or control characters.
Invalid input leaves the saved file unchanged.

To print the saved key in a later session:

```bash
bun run start openaip-key get
```

`get` prints only the key. OpenAIP key commands do not send Sentry telemetry.
If the configuration file contains malformed JSON or its root is not an object,
repair the file before saving. The CLI preserves its existing bytes.

## Enrich installed airports

Run `scan` to populate the addon database and save an OpenAIP API key with
`openaip-key set <key>`. Then enrich the installed airport records:

```bash
bun run start airports enrich
```

The command prints the number of airport rows enriched, unmatched, ambiguous, and skipped.
An empty airport table fails with instructions to run `scan`.
Rows with no usable code are skipped and do not require an API key.

Each lookup uses an exact four-letter ICAO code.
An airport without an ICAO code can use its three-letter IATA code instead.
Codes are trimmed and compared in uppercase. A malformed existing ICAO code is skipped.
Duplicate installed codes share one lookup. Fuzzy search results do not count as matches.
The command reads every result page and updates an airport only when its code has one unique match.
Multiple matches remain ambiguous, including repeated results without a provider ID.

Enrichment updates names, related airport codes, latitude, longitude, and elevation in meters.
Missing provider values and blank names preserve existing values. Zero and negative elevations are valid.
The command updates existing rows and preserves their IDs, package links, and source keys.
Rows whose identity changes during the lookup are skipped.
Repeated enrichment keeps the same rows and IDs.

Requests use the saved key and the GET `/airports` endpoint in the
[official OpenAIP API specification](https://api.core.openaip.net/api/system/specs/v1/schema.json).
OpenAIP requests reject redirects to keep the saved API key on `https://api.core.openaip.net`.
Responses are validated with Zod. Requests run sequentially, with a 30-second timeout per page.
Network, response validation, and pagination failures leave all airport rows unchanged.
Database updates commit together in one transaction after all lookups succeed.
Enrichment covers only the explicit airport records produced by `scan`.

## Configure Sentry telemetry

To create or replace your Sentry configuration, provide a DSN and all four sample rates:

```bash
bun run start sentry set --dsn 'https://publickey@o0.ingest.sentry.io/123456' \
  --errors 1 --logs 0 --metrics 0 --traces 0
```

Each rate must be a finite number from `0` to `1`.
`0` drops every item for that signal. `1` keeps every item.
Intermediate rates sample each signal independently.

To update selected values in an existing configuration:

```bash
bun run start sentry update --logs 0.1 --metrics 0.1 --traces 0.05
```

To print the saved DSN and sample rates as JSON:

```bash
bun run start sentry get
```

The CLI saves all settings in `~/.flightsim-things/config.json` with private file permissions.
Community and Sentry settings share this file, and saving one preserves all other settings.
`set` replaces the Sentry section and repairs an invalid DSN or sample rates.
If the shared file contains malformed JSON or its root is not an object, reads and saves fail
without changing its bytes. Repair the file first so existing settings can be preserved.
`update` requires a saved configuration and at least one option.
Invalid input leaves the saved file unchanged.

Configured commands use the official `@sentry/effect` SDK for errors, logs, metrics, and traces.
Logs and traces use generic command names. Error reports include the failure and stack.
The CLI records a completion metric and flushes telemetry before exit, with a bounded wait.
Help, version, argument errors, `sentry` configuration commands, and `openaip-key`
commands do not send telemetry.
Without a saved configuration, telemetry is disabled.
If configuration is malformed, telemetry is skipped and commands print instructions to repair it.

## Add CLI configuration settings

Import the shared default export from `#configuration` when a command needs persistent settings.
`get(key)` returns an Effect containing `Option<unknown>`; validate that value in the command's domain module.
`set(key, value)` replaces only the selected top-level value and preserves every other setting.
`update(key, callback)` reads the current optional value and runs a pure or Effect callback under
an interprocess lock before saving. Validate and merge partial domain changes inside that callback
so simultaneous commands cannot lose each other's changes. Values must be JSON-compatible.
The shared module owns filesystem access, locking, and private atomic writes.

## Run a release executable

Download the executable for your operating system and architecture from GitHub Releases.
The release includes Windows x64, macOS arm64, Linux x64, and Linux arm64 executables.
Each executable includes Bun and requires no separate runtime installation.

On macOS or Linux, give the downloaded file executable permission before running it.
For example, for Linux x64 version `0.1.0`:

```bash
chmod +x flightsim-things-0.1.0-linux-x64
./flightsim-things-0.1.0-linux-x64 --version
./flightsim-things-0.1.0-linux-x64 --help
```

The version command prints `flightsim-things v0.1.0`.
Windows executables end in `.exe`.
Use the executable in place of `bun run start` for the commands above.

## Prepare and publish a release

Craft comments on PRs with a changelog preview and semantic version impact, refreshed when the PR changes.

Enable **Allow GitHub Actions to create and approve pull requests** in the repository's **Settings > Actions > General**.
The workflows use `GITHUB_TOKEN` and require no additional release secret.

1. Run **Prepare release** on `main`. Choose `auto`, `major`, `minor`, `patch`, or a stable version such as `0.1.0`.
2. Review the generated `release/<version>` PR. Craft updates `package.json` and `CHANGELOG.md`.
3. Wait for **CI** and **Binaries** on the release branch, then merge the PR.
4. Wait for both workflows on the merged `main` commit. Copy the full merged commit SHA.
5. Run **Publish release** on `main` with the version without `v` and that SHA.

For example, to prepare a release through the GitHub CLI:

```bash
gh workflow run prepare-release.yml --ref main -f version=minor
```

To publish the reviewed release, replace the example SHA with the merged PR commit:

```bash
gh workflow run publish-release.yml --ref main \
  -f version=0.1.0 \
  -f release_sha=0123456789abcdef0123456789abcdef01234567
```

Publication requires a merged release PR, the matching manifest version, and successful checks for that exact commit.
The Binaries workflow builds and runs each executable on its native operating system and architecture.
Publication downloads those tested bytes from the verified workflow run.
The release contains four versioned executables and `SHA256SUMS`.
Publication uploads and verifies the assets in a draft before making the release public.

If publication fails after creating a draft, rerun it with the same version and SHA.
The workflow replaces the draft assets with the verified files.
A retry of an already public release verifies its assets without changing them.
A tag that points to a different commit fails publication.

Artifacts expire after 14 days.
GitHub permits workflow reruns only within 30 days of the original run.
Publish before artifacts expire, or restore them within that window.
After that window, prepare a new release.
To restore artifacts for an older release commit, find its main push Binaries run and rerun that run:

```bash
gh run list --workflow binaries.yml --branch main --event push --commit <merged-sha>
gh run rerun <run-id>
```

Wait for that run to succeed before publishing again.
To rebuild the current `main` commit, you can also run **Binaries** manually on `main`.

If preparation pushes a branch but fails to open its PR, inspect the version and changelog on that branch.
Open its PR manually and run both checks on the branch:

```bash
gh workflow run ci.yml --ref release/<version>
gh workflow run binaries.yml --ref release/<version>
```

## Build and verify executables locally

Build one target or all four targets with Bun:

```bash
bun run build linux-x64
bun run build all
```

The supported target IDs are `windows-x64`, `macos-arm64`, `linux-x64`, and `linux-arm64`.
The files appear in `dist` with the version from `package.json`.
Run the smoke check on the matching native host:

```bash
bun run verify:binary dist/flightsim-things-0.0.0-linux-x64
```

The check runs version, help, greeting, argument-error, and Community directory persistence commands in isolated user storage.
To generate checksums after building all four targets:

```bash
bun run stage:release dist
```

## Check Effect code

`bun install` runs `effect-tsgo patch --typescript --no-oxlint` through `prepare`.
The project pins `@effect/tsgo` to `0.51.1` and TypeScript to `7.0.2`, a supported compiler version for that release.
The patch adds Effect diagnostics to `bun run typecheck`, which runs `tsc --noEmit` in CI and the pre-commit hook.
Effect warnings and errors fail typecheck. Suggestions remain nonfatal.
`effect/cli`, `effect/ErrorReporter`, and `@effect/platform-bun` have an allowance for unstable APIs.

To run standalone Effect diagnostics:

```bash
bun run effect:diagnostics
```

To inspect setup options and regenerate the base configuration:

```bash
bunx @effect/tsgo@0.51.1 setup --help
bunx @effect/tsgo@0.51.1 setup --project tsconfig.json --non-interactive --typescript --no-oxlint --dependency-type devDependencies --preset recommended --preset correctness --diagnostic anyUnknownInErrorContext=error --diagnostic unsafeEffectTypeAssertion=error --vscode --apply
bun install
```

The setup uses the supported `recommended` and `correctness` presets.
`anyUnknownInErrorContext` and `unsafeEffectTypeAssertion` are explicitly errors.
Keep `--no-oxlint` when setting up or patching. Oxlint uses its existing configuration.

For VS Code and compatible editors, install the TypeScript 7 extension, select the workspace TypeScript version, and open a TypeScript file.
The committed `js/ts.experimental.useTsgo` and `js/ts.tsdk` settings point the native server at the patched workspace compiler.
Confirm that the native TypeScript server is active so that it loads `@effect/language-service`.

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Addon database

The addon database foundation stores general package, aircraft, airport, airline, and
livery metadata in `~/.flightsim-things/addons.sqlite` using Bun SQLite and Drizzle ORM.
Its scoped Effect interface initializes embedded migrations when used and closes the
connection after each operation. Insert, select, and update validation comes from
`drizzle-orm/effect-schema`. Drizzle's RC `defineRelations` graph supports typed nested
reads through `db.query`. Finish those reads with `.sync()` inside the database callback.

See [the schema, import mapping, and usage examples](docs/addon-database.md).
The `scan` command imports metadata from the saved Community directory.

After changing database tables, run `bun run db:generate` and review the generated SQL.
Release builds embed the complete `drizzle/` directory in each executable.
