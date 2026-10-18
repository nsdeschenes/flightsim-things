# flightsim-things

A CLI for Microsoft Flight Simulator 2024 addons. Scan your Community directory,
browse saved airports, aircraft, and airlines, enrich airports with OpenAIP, and
research potential flights with an AI provider.

## Install and run

Download an executable for Windows x64, macOS arm64, Linux x64, or Linux arm64 from
[GitHub Releases](https://github.com/nsdeschenes/flightsim-things/releases).
Executables include the runtime. On macOS and Linux, give the downloaded file
execute permission with `chmod +x <executable>`.

The examples below use an executable named `flightsim-things` on your `PATH`.
You can also use its full path, `./<executable>` on macOS and Linux, or
`.\<executable>.exe` in PowerShell.

To run from a checkout, install [Bun](https://bun.com) and the dependencies:

```sh
bun install
bun run start --help
```

Replace `flightsim-things` with `bun run start` in any example to run from source.

## First scan

Save an existing Community directory, scan its addons, and browse the results:

```sh
flightsim-things community-path set "C:\Games\MSFS 2024\Community"
flightsim-things scan
flightsim-things airports list
flightsim-things aircraft list
flightsim-things airlines list
```

Replace the example path with your Community directory. Scans populate a local
database. List commands read that database without rescanning your addons.
OpenAIP and AI configuration are optional for scanning and listing.

## Command reference

Values in `<angle-brackets>` are required. Items in `[square-brackets]` are optional.
Replace placeholders with your values and omit the brackets.

- [Interactive menu](#interactive-menu)
- [Community directory](#community-directory)
- [Scan addons](#scan-addons)
- [List airports](#list-airports)
- [List aircraft](#list-aircraft)
- [List airlines](#list-airlines)
- [OpenAIP API key](#openaip-api-key)
- [Enrich airports](#enrich-airports)
- [AI configuration](#ai-configuration)
- [Find potential flights](#find-potential-flights)
- [Sentry telemetry](#sentry-telemetry)

```text
flightsim-things
flightsim-things tui
flightsim-things community-path get
flightsim-things community-path set <path>
flightsim-things community-path update <path>
flightsim-things scan [--verbose]
flightsim-things airports list [--code <code>]
flightsim-things aircraft list [--code <code>] [--airline <code>]
flightsim-things airlines list [--code <code>] [--aircraft <code>]
flightsim-things openaip-key get
flightsim-things openaip-key set <key>
flightsim-things airports enrich
flightsim-things ai get
flightsim-things ai set --provider <provider> --model <model> --api-key <key>
flightsim-things find-flight [--dep <code>] [--arr <code>] [--aircraft <code>] [--airline <code>]
flightsim-things sentry get
flightsim-things sentry set --dsn <dsn> --errors <rate> --logs <rate> --metrics <rate> --traces <rate>
flightsim-things sentry update [--dsn <dsn>] [--errors <rate>] [--logs <rate>] [--metrics <rate>] [--traces <rate>]
```

`find-flight` requires at least one endpoint, or both aircraft and airline filters.
`sentry update` requires at least one option and an existing configuration.

### Help and version

Append `--help` or `-h` to any command or command group to see its usage.
Use `--version` or `-v` to print the application version.

```sh
flightsim-things --help
flightsim-things --version
flightsim-things airports --help
flightsim-things aircraft list --help
```

### Interactive menu

```sh
flightsim-things tui
```

With no arguments, `flightsim-things` opens the same menu. The menu requires a
terminal for both input and output. Use explicit commands when piping output.

Use the arrow keys and Enter to select a command and answer its prompts.
Commands return to the menu after completion, including after a failure.
Choose **back** in a submenu to return to the main menu.
Escape in a submenu or argument prompt discards the pending command.
Choose **Exit**, press Escape at the main menu, or press Ctrl+C or Ctrl+D at a
prompt to close the session. Ctrl+C during a running command stops the command
and ends the session.

API key prompts hide your input. Selecting `openaip-key get` prints the saved key.
The menu rejects values that look like help or version flags. To save such a
positional value through a direct command, put it after `--`:

```sh
flightsim-things openaip-key set -- --help
```

#### Desktop launchers

Each release also has a `desktop.tar.gz` bundle for each supported platform.
Extract the entire bundle into a folder and open its launcher.

- Windows x64 uses `Launch flightsim-things.cmd`.
- macOS arm64 uses `Launch flightsim-things.command`.
- Linux x64 and arm64 use `Launch flightsim-things.sh`.

Keep the launcher beside the bundled `flightsim-things` or `flightsim-things.exe`.
The folder can move, and its path can contain spaces.
If your archive manager cannot extract the bundle, run `tar -xzf <archive>` in an
empty folder.

On Linux, choose **Run as a program** or **Run in terminal** if prompted.
The launcher uses `x-terminal-emulator`, GNOME Terminal, Konsole, Xfce Terminal,
or xterm. If none is installed, run `./flightsim-things tui` in a terminal.

If extraction removes executable permissions, restore them on macOS:

```sh
chmod +x flightsim-things 'Launch flightsim-things.command'
```

On Linux, use `Launch flightsim-things.sh` in that command.

### Community directory

```text
flightsim-things community-path get
flightsim-things community-path set <path>
flightsim-things community-path update <path>
```

`get` prints the saved directory. `set` and `update` both save or replace it.
The directory must exist. Relative paths resolve from the current working
directory. Quoted `~` paths are supported. Quote paths that contain spaces.

```sh
flightsim-things community-path set "C:\Games\MSFS 2024\Community"
flightsim-things community-path update "~/Games/MSFS 2024/Community"
flightsim-things community-path get
```

### Scan addons

Requires a saved Community directory.

```sh
flightsim-things scan
flightsim-things scan --verbose
```

Scans save package, aircraft, livery, airport, and airline metadata locally.
Repeated scans update existing records but retain records for removed addons.
Malformed packages are skipped and cause a nonzero exit status. Fix the reported
errors and scan again.

By default, scans show the first five warning details and count every warning.
`--verbose` shows all warning details. Package errors are always shown.

Airport detection uses explicit airport XML or `AirportServices` entries.
For BGL scenery without explicit airports, the scanner can infer one code from a
package directory such as `amsim-airport-lpma-madeira`. This fallback requires
`vendor-airport-CODE-name`, with a four-character alphanumeric code. Vendor names
can contain hyphens. Later explicit metadata replaces the fallback.

The scanner does not decode compiled BGL scenery, so airport coverage can be
incomplete. Inferred names, IATA codes, and locations remain unknown until enrichment.

### List airports

```sh
flightsim-things airports list
flightsim-things airports list --code KJFK
flightsim-things airports list --code JFK
```

`--code <code>` matches an exact airport ICAO or IATA code, ignoring case and
surrounding whitespace. The ASCII table includes every airport database column
and the package directory. Missing values are blank. Rows sort by ICAO code,
name, and ID, with missing codes and names first.

Directory cells always include clickable terminal hyperlinks, including in piped
output. Terminals that support hyperlinks open the package directory.

### List aircraft

```sh
flightsim-things aircraft list
flightsim-things aircraft list --code A320
flightsim-things aircraft list --airline BAW
flightsim-things aircraft list --code A320 --airline BAW
```

`--code <code>` matches an exact aircraft ICAO type designator.
`--airline <code>` matches an exact airline ICAO code through a saved livery
linked to both the aircraft and airline. Unresolved livery links do not match.
Both filters ignore case and surrounding whitespace. With both filters, a
record must match both. Each aircraft appears once, even with multiple matching liveries.

The ASCII table includes every aircraft database column and the aircraft package
directory. Missing values are blank. Rows sort by ICAO type designator, name,
and ID. Directory cells always include clickable terminal hyperlinks, including
in piped output.

### List airlines

```sh
flightsim-things airlines list
flightsim-things airlines list --code BAW
flightsim-things airlines list --aircraft A320
flightsim-things airlines list --code BAW --aircraft A320
```

`--code <code>` matches an exact airline ICAO code. Airline IATA codes do not match.
`--aircraft <code>` matches an exact aircraft ICAO type designator through a saved
livery linked to both the airline and aircraft. Unresolved aircraft links do not match.
Both filters ignore case and surrounding whitespace. With both filters, a
record must match both. Each airline appears once, even with multiple matching liveries.
Without an aircraft filter, the list includes saved airlines with no linked liveries.

The ASCII table shows ID, ICAO code, IATA code, and name. Missing values are blank.
Rows sort by ICAO code, name, and ID. Output is plain text without directory links.

### OpenAIP API key

```text
flightsim-things openaip-key set <key>
flightsim-things openaip-key get
```

Sign in at [OpenAIP](https://www.openaip.net/), open **API clients**, create a
client, and copy its API key.

```sh
flightsim-things openaip-key set 'your-api-key'
```

`set` saves or replaces the key. `get` prints the full saved key without masking it.

### Enrich airports

Requires a scan and a saved OpenAIP API key.

```sh
flightsim-things airports enrich
```

Enrichment adds airport names, codes, coordinates, and elevations using exact
ICAO or IATA matches. Unmatched or ambiguous airports stay unchanged.
The command reports enriched, unmatched, ambiguous, and skipped counts.
If any lookup fails, no airport updates are saved.

### AI configuration

```text
flightsim-things ai set --provider <provider> --model <model> --api-key <key>
flightsim-things ai get
```

`set` saves or replaces the entire configuration. All three flags are required.
`--provider` accepts `openai`, `anthropic`, or `google`.
`--model` is the provider's model ID. For `find-flight`, the model must support
its provider's web search and structured output.

```sh
flightsim-things ai set --provider openai --model 'your-model-id' --api-key 'your-api-key'
flightsim-things ai get
```

`get` prints the provider and model with a masked API key.
Configuration commands make no AI requests.

### Find potential flights

Requires a scan, saved airport codes, and a configured AI model.
Aircraft and airlines require saved liveries linked to both.
Use `airports enrich` to fill missing airport codes.

```sh
flightsim-things find-flight --dep EGLL
flightsim-things find-flight --arr LFPG
flightsim-things find-flight --dep EGLL --arr LFPG
flightsim-things find-flight --aircraft A320 --airline BAW
flightsim-things find-flight --dep EGLL --aircraft A320 --airline BAW
flightsim-things find-flight --arr LFPG --aircraft A320
```

`--dep <code>` fixes the departure airport. `--arr <code>` fixes the destination.
Both accept airport ICAO or IATA codes. With a single endpoint flag, the airport
you enter need not be installed. The other endpoint comes from saved airports.
With both flags, the destination must match an identified saved airport distinct
from the departure. The departure need not be installed.

Without either endpoint flag, both `--aircraft` and `--airline` are required.
This mode discovers routes between at least two distinct identified saved
airports and shows both endpoints.

`--aircraft <code>` filters by aircraft ICAO type designator.
`--airline <code>` filters by airline ICAO code. Both filters can also restrict
an endpoint search. They must match the same saved livery.
Codes ignore case and surrounding whitespace. Names, airline IATA codes, and
related aircraft variants do not match. No matching livery stops the command
before paid AI requests.

Each search makes two paid AI requests, one for web research and one to select
flights from your inventory. Search sends airport, aircraft, airline, and livery
identities to the configured provider. Results include source links and are
potential flights, not confirmed schedules.

The command reads the saved inventory without rescanning addons or changing
their metadata. Saved records can include removed addons.

### Sentry telemetry

Telemetry is disabled until Sentry is configured.

```text
flightsim-things sentry set --dsn <dsn> --errors <rate> --logs <rate> --metrics <rate> --traces <rate>
flightsim-things sentry update [--dsn <dsn>] [--errors <rate>] [--logs <rate>] [--metrics <rate>] [--traces <rate>]
flightsim-things sentry get
```

`set` requires the DSN and all four sample rates. It replaces any saved Sentry
configuration. Each rate ranges from `0` for off to `1` for all events.
`update` changes selected values in an existing configuration and requires at
least one option. `get` prints the saved DSN and sample rates as JSON.

```sh
flightsim-things sentry set --dsn 'https://publickey@o0.ingest.sentry.io/123456' --errors 1 --logs 0 --metrics 0 --traces 0
flightsim-things sentry update --logs 1
flightsim-things sentry get
```

Scan diagnostics use structured Sentry Logs at the saved log sample rate,
including warnings omitted from the console. Expected package failures do not
create Issues. Unexpected failures retain error reporting.

Package failure logs contain a safe reason and, when available, a relative
filename or operating system error code. XML diagnostics include the package
name, relative filename, fixed parser or validation reason, root element,
encoding hints, and whether the file was skipped or the package rejected.
They exclude XML source and absolute package paths. Raw configuration, JSON
values, and private filesystem error details stay in the terminal.

Help, version, argument errors, and Sentry, OpenAIP key, and AI configuration
commands do not send telemetry. With tracing enabled, AI SDK calls record model
and token usage, prompts, and generated outputs through the Vercel AI integration.

## Local data

Files are stored in `~/.flightsim-things/`.

- `config.json` stores the Community path, OpenAIP API key, AI provider settings, and Sentry settings with private file permissions.
- `addons.sqlite` stores scanned addon metadata and enriched airports.

API keys are plaintext in `config.json`. AI keys are redacted in runtime
configuration values and in `ai get` output. `openaip-key get` prints the full key.

## Exit status

Direct commands return `0` on success, `1` on command failure, `251` for an unknown
subcommand, and `252` for argument parsing errors. Values rejected by command
validation return `1`. Help and version return `0`.
A scan with failed packages returns `1` even when other packages were saved.
An empty list or a flight search with no supported results is successful.

## Development

```sh
bun run test
bun run test:source
bun run test:acceptance
bun run typecheck
bun run lint
bun run fmt:check
```

`bun run test` runs both suites. Source tests live beside their modules in `src/`.
Acceptance tests in `acceptance/` exercise the CLI and release tooling through
subprocesses. Bare `bun test` runs only the source suite.

Run one acceptance file with `bun run test:acceptance ./commands/ai.test.ts`.
Set `FLIGHTSIM_TEST_BINARY` to an absolute or repository-relative executable path
to run application acceptance against a compiled binary.
Release-tool tests keep using `scripts/release.ts`.

`bun install` patches the TypeScript compiler with Effect diagnostics, which run
during `typecheck`. Use `bun run effect:diagnostics` to run them separately.
After changing database tables, run `bun run db:generate` and review the generated SQL.

- [Addon database schema and usage](docs/addon-database.md)
- [Building executables and publishing releases](docs/releases.md)
