# Community directory picker

This report records the research and implementation for
[issue #43](https://github.com/nsdeschenes/flightsim-things/issues/43).

## Selected interaction

In `flightsim-things tui`, choose `community-path`, then `set` or `update`.
Choose **Browse directories**, **Enter a path**, or **back**.
The browser returns a directory path. Manual entry accepts the same strings as
the direct CLI, including relative paths and literal `~/` paths.

The browser highlights an existing, readable saved directory in its parent.
For a saved filesystem root, it opens at that root without a highlighted default.
An unusable saved path falls back to the working directory, then the home
directory. If neither can be listed, manual entry remains available.
Saved-path read errors appear in the terminal rather than silently resetting
configuration.

Type to filter names. Arrow keys move through the results, with eight entries
per page. Enter on a directory with subdirectories opens Effect's traversal
question. Press `y` to enter it or `n` to select it. A directory with no visible
subdirectories submits immediately, even when it contains ordinary files.
The application prints these instructions before browsing.

Selection submits the ordinary command and saves the path. There is no additional
save confirmation. Browsing, filtering, traversal, and cancellation do not save.
Escape returns to the main menu. Ctrl+C and Ctrl+D exit the TUI.
These cancellation guarantees apply before submission. Once a save starts,
the existing configuration transaction can finish atomically.

## Usage and ownership

The caller prepares an invocation rather than a saved setting:

```ts
const outcome = yield * communityDirectory.prepare('update');
// Back, or Args containing ['community-path', 'update', selectedPath].
```

The illustrative result shape is a small union:

```ts
type Prepared =
  | Readonly<{kind: 'Back'}>
  | Readonly<{
      kind: 'Args';
      args: readonly ['community-path', 'set' | 'update', string];
    }>;
```

`src/commands/community-directory.ts` owns input selection and browser recovery.
`prepareCustomCommand` in `src/commands/tui.ts` recognizes only the exact set and
update paths and bypasses the generic wizard for them. Prepared arguments pass
through `prepareArguments` and `Command.runWith`, then the existing save handler.
A spaced path occupies one argv element. No shell quoting or reparsing occurs.

`src/community-path.ts` remains the normalization and validation owner.
It expands tilde paths, resolves relative paths, checks that the target is a
directory, and asks the configuration service to save it. Symlinks follow their
targets during validation, while the saved path retains its lexical spelling.
The configuration service still owns locking, preservation of unrelated keys,
and atomic replacement. The picker never calls its setter.

## Alternatives and installed API evidence

The verified installed versions are Bun 1.4.2 and Effect 4.0.2 after
`bun install --frozen-lockfile`. The initial acceptance attempt could not resolve
`msw/node`. The locked install removed that setup blocker. The issue's earlier
`drizzle-orm/effect-schema` blocker did not recur.

Read-only inspection covered `repos/effect/packages/effect/src/cli` and the exact
installed `node_modules/effect/src/cli` implementation. Application imports use
`effect/cli`. The vendored repository and lint rules remain unchanged.

`Prompt.File` supports `type: 'directory'`, `startingPath`, `default`, filtering,
and `maxPerPage`. Its default selects the basename in the default path's parent.
A missing default can instead highlight `..`, so the application checks the
saved target and parent before passing a default.

The generic wizard uses `Prompt.String` for path primitives. Changing the
argument to `Argument.Directory` therefore does not enable browsing.
`Argument.Directory('path', {mustExist: true})` also validates before the settings
owner expands literal tilde input. It changes empty-input handling and turns
some command failures into argument errors. This implementation retains
`Argument.String` and the existing direct CLI validation contract.

`Argument.withFallbackPrompt` runs only for missing input. It has no automatic
TTY guard, converts `QuitError` into the original missing-input error, and does
not replace the generic wizard's string prompt. A dedicated TUI preparation step
reuses the application's terminal gate and cancellation lifecycle instead.
Both stdin and stdout must be TTYs to enter the TUI. Direct set and update
commands require a path even when run in a terminal, and never open the picker.

A command-owned preparation export was also considered. The sibling module
keeps interactive policy out of the explicit CLI command definition.
A custom browser with drive selection and per-entry error recovery was rejected
as too large for this bounded change. Manual input handles those cases.

## Filesystem failures and platform limits

The installed `Prompt.File` uses `Effect.orDie` for enumeration and stat failures.
One broken symlink among sibling entries can abort a listing. A directory may
also disappear or become inaccessible after preflight. A local `catchDefect`
around the browser displays an error and returns to input selection.
Typed `QuitError` and interruption continue to the existing TUI session handler.
No broad recovery surrounds settings validation or command execution.

Preflight checks directory type and enumeration, rather than assuming stat
proves readability. It does not duplicate the browser's per-entry stat algorithm.
Malformed configuration remains unchanged if a later replacement attempt fails.
Final settings validation also catches a target removed after selection.

Runtime verification is on Linux x64 under an unprivileged user with uid 1000.
The acceptance fixtures exercise spaces, symlinks, filesystem roots, missing
saved targets and parents, unreadable directories, broken links, and paging.
Native Windows drive paths, UNC shares, junctions, cross-drive navigation, and
macOS terminals remain unverified. `Prompt.File` has no drive chooser.
Manual input and direct CLI paths remain available, but Linux results do not
establish Windows or macOS compatibility.

## Reproduce the verification

From a checkout, install the locked dependencies and inspect their versions:

```sh
bun install --frozen-lockfile
bun --version
bun -e 'console.log(require("effect/package.json").version)'
```

The acceptance tests provide executable fixture setup through
`acceptance/support/cli.ts` and real PTYs through
`acceptance/support/terminal.ts`. Each test creates an isolated temporary home
and removes it afterward. The picker fixture creates directories with spaces,
addon subdirectories, twelve page entries, a symlink, and separate missing or
unreadable targets. Permission cases use mode `000` and restore permissions
before cleanup. Run them as an unprivileged user because root bypasses these
permission checks.

Run the picker experiment and direct CLI regression tests:

```sh
bun test --cwd acceptance community-directory-picker.test.ts
bun test --cwd acceptance commands/community-path.test.ts
bun test --cwd acceptance tui.test.ts
```

Expected picker outcomes include both set and update saving a spaced path,
`y` traversing and `n` selecting, and saved defaults selecting the original path.
Cancellation at source, manual entry, listing, traversal confirmation, and a
traversed listing preserves the previous configuration bytes or leaves the
configuration absent. Filesystem failures return to usable manual entry and
retain cancellation. Direct missing input exits with code 252 under a PTY.
The existing direct CLI cases verify noninteractive absolute, relative, spaced,
and literal tilde paths, plus unchanged rejection behavior for invalid input.

Run the project checks and host binary acceptance:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test:source
bun run test:acceptance
bun run build linux-x64
bun run verify:binary dist/flightsim-things-1.0.0-linux-x64
FLIGHTSIM_TEST_BINARY=dist/flightsim-things-1.0.0-linux-x64 bun test --cwd acceptance community-directory-picker.test.ts commands/community-path.test.ts
```

Observed results on Linux x64 are:

- Typecheck, lint, formatting, and `git diff --check` pass.
- The source suite passes all 217 tests.
- The final full acceptance suite passes all 331 tests across 25 files.
- The Linux x64 release build and binary smoke check pass.
- All 54 picker and direct Community path acceptance tests pass against the
  compiled binary, including the permission and cancellation scenarios.

## Bounded implementation

The implementation adds one picker module, a TUI preparation branch, terminal
acceptance tests, and usage documentation. It leaves simulator discovery,
configuration format changes, and settings-service replacement outside scope.
The first acceptance runs exposed paging fixture assumptions about Bun's hidden
`.bun` directory and the difference between a visible row and a selected row.
The final fixture filters its named entries, asserts that arrow navigation
selects more than one page of distinct entries, then waits for the exact final
filter before submission. The corrected binary acceptance run passes.
