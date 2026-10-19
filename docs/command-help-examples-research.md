# Command help examples

[Issue #48](https://github.com/nsdeschenes/flightsim-things/issues/48) asks how help can show practical commands. Native `Command.withExamples` metadata now provides setup, configuration, and flight search examples beside the definitions that own their syntax.

The main priority is a usable setup sequence. Root help starts with an existing Community directory, a scan, and detailed flight search help. The existing root and AI wizard examples remain available. AI and Sentry configuration are optional for scanning.

## Existing support and dependency versions

The [`Command.Example` model](../repos/effect/packages/effect/src/cli/Command.ts) already represents an example as a command string and optional description. `withExamples` attaches these records to a command. The native renderer prints descriptions as `#` lines in an `EXAMPLES` section. Parent help does not collect child examples, so configuration groups and their relevant leaves each need examples.

Research on 2026-10-19 used Bun 1.4.2, installed `effect` 4.0.2, `@effect/platform-bun` 4.0.2, and `drizzle-orm` 1.0.0-rc.4. The [manifest](../package.json) requests `effect ^4.0.2`, and the [lockfile](../bun.lock) pins 4.0.2. The vendored Effect package reports 4.0.3. Installed and vendored source share the example model, but runtime checks use the installed package.

The issue's earlier `drizzle-orm/effect-schema` blocker did not recur when running the current CLI. Before this change, root help already contained the two wizard examples. Flight and configuration help lacked the practical examples added here.

## Selected design

Examples live beside `Command.withDescription` in each affected command module. A short literal command can appear on both group and leaf help. This duplication keeps the syntax visible where a user requests help.

The implementation covers these commands:

- Root setup and the existing wizard examples.
- Community set and update, including group help.
- Standard and verbose scans.
- Departure, arrival, fixed-route, and inventory flight searches, plus a filtered departure search.
- AI set and its wizard, plus the masked configuration overview.
- OpenAIP key set, including group help.
- Sentry complete set and partial update, including group help.

A shared example registry would add another place to coordinate command paths without checking their validity. A custom formatter would duplicate rendering behavior already supplied by Effect. Root-only examples would leave nested help incomplete. These alternatives add maintenance without solving another requirement.

Inventory listing examples remain lower priority. Database clear and remote airport enrichment do not belong in the setup sequence. OpenAIP get prints the saved key, so its overview shows only set. No parser, handler, dependency, or vendored code changes are needed. The `#ordinary-commands` package import gives acceptance tests a lint-compliant way to inspect the existing command tree.

## Copyable syntax and prerequisites

The canonical executable token is `flightsim-things`. The [release builder](../scripts/release.ts) also creates versioned executable names. Root help explains replacing the token with the executable being run, including `./filename` on Unix and `.\filename.exe` on Windows. Examples remain literal strings rather than depending on the current executable basename.

Community paths use double quotes so a directory with spaces remains one argument. Replace the illustrative path with an existing directory on the user's machine.

```sh
flightsim-things community-path set "C:/Flight Simulator/Community"
flightsim-things scan
flightsim-things find-flight --help
```

Flight examples use ICAO aircraft and airline identifiers. Searches need matching saved aircraft and liveries, plus identified saved airports. Results are potential flights rather than confirmed schedules.

```sh
flightsim-things find-flight --dep EGLL
flightsim-things find-flight --arr LFPG
flightsim-things find-flight --dep EGLL --arr LFPG
flightsim-things find-flight --aircraft A320 --airline BAW
flightsim-things find-flight --dep EGLL --aircraft A320 --airline BAW
```

AI set replaces the provider, model, and API key together. Uppercase tokens identify values the user must replace. The wizard avoids putting a key in shell history. OpenAIP set uses the same placeholder convention.

```sh
flightsim-things ai set --provider openai --model YOUR_MODEL_ID --api-key YOUR_API_KEY
flightsim-things ai set --wizard
flightsim-things openaip-key set YOUR_OPENAIP_API_KEY
```

Sentry set requires the DSN and all four rates. Its fake DSN uses `.invalid`, and all rates are zero, so the example leaves telemetry disabled. Replace the DSN and raise the rates for the signals you want to enable. Partial update requires an existing complete configuration and at least one supplied option.

```sh
flightsim-things sentry set --dsn https://YOUR_PUBLIC_KEY@example.invalid/1 --errors 0 --logs 0 --metrics 0 --traces 0
flightsim-things sentry update --traces 0
```

The rendered flight help includes command descriptions as shell comments.

```text
EXAMPLES
  # Find potential flights from an airport. Searches need matching saved aircraft and liveries plus identified saved airports. Results are not confirmed schedules.
  flightsim-things find-flight --dep EGLL

  # Find potential flights to an airport using saved inventory.
  flightsim-things find-flight --arr LFPG
```

The long Sentry command is deliberate. Omitting a required rate would produce an invalid set command. The flight help probe retained complete command lines at 180 and 40 columns. The committed PTY tests check root and full Sentry set help at 180 columns. The native formatter does not insert line breaks for terminal width. Terminals can soft wrap long lines, so manual shell continuations are unnecessary.

## Reproducible verification

Run these commands from the repository root after installing the locked dependencies.

```sh
bun install --frozen-lockfile
bun test --cwd acceptance help-examples.test.ts
bun test --cwd acceptance wizard.test.ts
bun run typecheck
bun run lint
bun run fmt:check
```

[`help-examples.test.ts`](../acceptance/help-examples.test.ts) reads the actual rendered `EXAMPLES` section on every affected help page. It compares the displayed commands with literal expectations. A restricted test-local tokenizer preserves quoted paths and rejects unsupported or unmatched syntax. It never evaluates example text in a shell.

The parser checks clone the real command tree through public `withHandler` and `withSubcommands` APIs. Inert handlers capture the selected leaf and parsed values. Assertions check literal paths, credentials, rates, ICAO values, and optional flags. Sentry examples cannot refresh telemetry or write configuration through this clone. Root and long nested help also run through the existing PTY helper at 180 columns.

Parser acceptance does not establish handler constraints. The isolated CLI fixture separately saves a real directory containing spaces, scans its empty contents, and checks saved fake AI values. Each flight example then reaches its expected missing-inventory error before any provider request. These checks establish query selection and prerequisites, not successful remote flight research. Existing wizard acceptance tests cover the custom wizard adapter that intercepts `--wizard` before ordinary parsing.

Observed baseline setup saved the full spaced path and scanned zero packages successfully. Fake configuration values persisted in the temporary home. Each flight mode reached its own inventory prerequisite. The implemented checks retain those behaviors while checking the newly displayed syntax. They do not run destructive commands or contact AI, OpenAIP, or Sentry providers.

A compiled host binary can use the same acceptance fixture. These commands build the Linux x64 artifact at the current manifest version and rerun the focused checks against it.

```sh
bun run build linux-x64
bun run verify:binary dist/flightsim-things-1.0.0-linux-x64
FLIGHTSIM_TEST_BINARY=dist/flightsim-things-1.0.0-linux-x64 bun test --cwd acceptance help-examples.test.ts
```

The [release documentation](./releases.md) describes other host targets. Cross-platform filenames are covered by release tests and executable-substitution text. These checks do not claim that foreign-platform binaries ran on the host.
