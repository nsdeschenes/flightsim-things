# Direct command wizard research

Issue [#45](https://github.com/nsdeschenes/flightsim-things/issues/45) adds a one-shot alternative to the persistent terminal menu. The selected design collects values for an existing command, asks for confirmation, executes once, and exits.

Research on 2026-10-18 used Bun 1.4.2 and installed Effect 4.0.2. The vendored Effect package reports 4.0.3. Its enclosing application revision was `e0e303b2fa1e08b23145d7f23442febc58c15324`, not an upstream Effect revision.

## Source findings

The public `Command.wizard` in installed `node_modules/effect/src/cli/Command.ts` accepts a command and a `prefix`, then returns executable `string[]` arguments. It does not expose the internal `commandPath` option or masked display arguments. Resolve a nested command through public `subcommands` metadata and call the collector on that command object.

Installed `node_modules/effect/src/cli/internal/wizard.ts` prompts for flags, arguments, and visible children. Optional values first ask whether to include them, with no selected. Redacted declarations use password prompts. Option-looking flag values serialize inline, such as `--model=--help`. Positional values remain standalone.

The [`vendored collector`](../repos/effect/packages/effect/src/cli/internal/wizard.ts) follows the same collection and serialization rules. Its color-theme changes do not fix supplied-prefix previews. Application code imports installed package entry points and leaves vendored files unchanged.

`Command.runWith` has a special native wizard branch. It copies supplied arguments into the collector prefix, prints a final preview, defaults confirmation to yes, and recursively executes the result. Supplied prefix values have identical executable and display strings. Redacted parameter metadata does not mask those supplied values.

The existing [`TUI`](../src/commands/tui.ts) already separates collection from selected execution. It also owns directory browsing, inventory selection, and guided flight search. The direct wizard uses generic command prompts and leaves these specialized flows in the TUI.

## Observed behavior and the rejected shortcut

Research probes used fake credentials, isolated fixture homes, PTYs, and a local Sentry receiver. Enabling `GlobalFlag.Wizard` directly exposed a supplied fake secret in `Current command`. Supplying a flag and then entering another value produced duplicate flags, and the original supplied value won. Native cancellation returned success through an ordinary invocation wrapper, which incorrectly recorded a command completion. Root-selected sensitive commands also inherited the root invocation's telemetry policy.

Public collection on a selected leaf with a path-only prefix masked the entered password and returned arguments without executing a handler. An application-owned default-no confirmation ran a test handler once on acceptance and zero times on decline. These observations rule out naive native enablement for this application.

Keeping only the TUI would avoid another entry point. The one-shot wizard is useful when you already know a command path and want to exit after running it. Specialized choices and repeated commands remain reasons to use the TUI.

A further pre-change probe, `bun src/index.ts --wizard --completions judge-fake-secret-45`, echoed the fake value in an invalid-completion diagnostic. The implementation suppresses detailed failures for wizard-bearing help, version, and completion requests while preserving successful control output.

Run this isolated native-preview probe from the repository root after installing dependencies. It exercises installed Effect with the repository's CLI and terminal helpers. The printed sentinel is deliberately fake.

```sh
bun - <<'JS'
import assert from 'node:assert/strict';
import createCliFixture from './acceptance/support/cli.ts';
import createTerminalSession from './acceptance/support/terminal.ts';
const fixture = await createCliFixture();
const program = `
import {BunRuntime, BunServices} from ${JSON.stringify(import.meta.resolve('@effect/platform-bun'))};
import {Console, Effect} from ${JSON.stringify(import.meta.resolve('effect'))};
import {Argument, CliConfig, Command, GlobalFlag} from ${JSON.stringify(import.meta.resolve('effect/cli'))};
const command = Command.make('probe', {key: Argument.Redacted('key')}, () => Console.log('HANDLER-RAN'));
BunRuntime.runMain(Command.runWith(command, {version: '1.0.0'})(process.argv.slice(1)).pipe(
 Effect.provide([BunServices.layer, CliConfig.layer({builtIns: [GlobalFlag.Wizard]})])
));`;
const sentinel = 'wizard-supplied-fake-key-45';
const session = createTerminalSession(
 [process.execPath, '--eval', program], fixture.home, [sentinel, '--wizard']
);
try {
 await session.waitFor('Key');
 assert(session.output().includes(sentinel));
 session.send('\u0003');
 assert.equal(await session.exited, 0);
 assert(!session.output().includes('HANDLER-RAN'));
 console.log('Native preview exposed the fake supplied key; cancellation ran no handler.');
} finally {
 await session.dispose();
 await fixture.dispose();
}
JS
```

## Selected design and bounded implementation plan

The preparation result is a discriminated union. `Ordinary` retains its arguments and indicates whether control errors need sanitization. `Confirmed` holds Redacted executable arguments. `Stopped` cannot enter execution. A private target pairs the selected canonical command object with its command-name path.

The implementation follows these steps:

1. Validate bare `--wizard` plus an ordinary command path. Resolve root, group, or leaf through the existing command tree. Reject supplied values, malformed Boolean spellings, unknown paths, and `tui` with a fixed diagnostic.
2. Preserve existing help, version, and completion precedence. For wizard-bearing control failures, render fixed diagnostics without argument values.
3. Require terminals for input and output. Collect with public `Command.wizard` and a canonical path-only prefix. Reject generated standalone controls and `--` before replay. Retain safe inline flag values.
4. Show command names with values omitted. Ask `Run this command?` with no selected. Decline, Ctrl+C, and Ctrl+D stop successfully.
5. Execute confirmed arguments through the ordinary tree. Reclassify the selected invocation before instrumentation and error rendering. Keep one outer Sentry runtime and preserve handler exit codes.

[`direct-wizard.ts`](../src/direct-wizard.ts) owns preparation and cannot run command handlers. The local executor in [`index.ts`](../src/index.ts) owns classification, instrumentation, execution, and failure rendering. Collection, cancellation, and decline emit no command telemetry. Confirmed commands use existing exclusions for AI, OpenAIP key, and Sentry commands. Recorded ordinary commands emit one completion log, a counter increment of one, and one transaction when sampling permits.

The Redacted wrapper prevents accidental inspection of prepared arguments. It does not erase plaintext strings from memory. Intentional confirmed `openaip-key get` output still prints the saved key. Plain string prompts display entered non-secret values. Only Redacted declarations promise hidden input.

## Reproduce acceptance checks

The focused suite uses [`createCliFixture`](../acceptance/support/cli.ts) for a disposable HOME and USERPROFILE. [`createTerminalSession`](../acceptance/support/terminal.ts) drives real commands through a PTY. Every test configures a loopback Sentry receiver with all sample rates set to one. No remote telemetry or AI request is needed.

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun test --cwd acceptance wizard.test.ts
bun test --cwd acceptance --test-name-pattern 'Sentry stays active across repeated menu commands' tui.test.ts
bun run typecheck
bun run lint
bun run fmt:check
```

The focused cases check root, group, and leaf selection, actual configuration writes, optional skips and filtering against seeded inventory, and confirmed handler failures. They inspect envelope items separately from headers and assert one transaction, one completion log, and one `cli.command.completed` counter item with value `1`. Decline and cancellation preserve configuration bytes and create no database. Root-selected AI and OpenAIP commands save fake keys without exposing them in terminal output or telemetry. Other cases cover generated controls, supplied secrets, malformed higher controls, successful control precedence, safe inline values, and each terminal prerequisite.

The PTY checks require Bun terminal support on POSIX. The one-sided redirection checks also require Bash. This work does not verify Windows console behavior or network delivery guarantees. Sampling, transport retries, and Sentry ingestion are separate from recording one command invocation. Literal terminal EOF is not simulated independently of Ctrl+D. Escape retains Effect's prompt behavior and has no promised menu-navigation meaning here.

## Observed validation results

The completed implementation passed the full repository suites:

```sh
bun run test:source
bun run test:acceptance
```

The source suite passed 237 tests. The acceptance suite passed 414 tests, including all 48 direct-wizard cases. No tests failed. Two generated-shell syntax checks were skipped because Zsh and Fish were unavailable.

The embedded native-preview reproduction passed. `bun run typecheck`, `bun run lint`, `bun run fmt:check`, and `git diff --check` passed.
