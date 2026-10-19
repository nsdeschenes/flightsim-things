# Confirmation before clearing saved records

The TUI and direct wizard now show target consequences and require an affirmative
answer before running `database clear`. Enter selects No. Explicit CLI invocation
remains prompt-free for scripts. The existing clear transaction is unchanged.

## Preparation owns consent

This usage-first sketch illustrates the boundary. It omits the existing control-flag
guard and navigation handling.

```ts
const args = yield * commandInput.collect(command, path);
const confirmed = yield * commandInput.confirm(args, 'Tui');
if (!confirmed) {
  return {kind: 'Retry'};
}

return {kind: 'Prepared', args};
```

The shared operation has this signature. The signature describes the implemented
adapter rather than a required public API.

```ts
function confirm(
  args: readonly string[],
  surface: 'Tui' | 'Wizard'
): Effect.Effect<boolean, QuitError, Prompt.Environment>;
```

`src/command-confirmation.ts` recognizes ordinary commands, valid clears, and invalid
clear shapes. Only exactly `database clear TARGET` with a known target can reach a
clear question. Unknown targets, missing targets, and extra arguments return false.
The module does not print arguments or acquire the database.

`src/commands/database-clear-targets.ts` contains the existing ordered table definitions.
Both the handler and the exhaustive consequence map derive their target types from
that definition. The confirmation module imports the definition only as a type.
`commandInput.confirm` exposes the policy beside argument collection.

The TUI keeps its `Prepared`, `Retry`, and `Exit` outcomes. Decline becomes `Retry`.
The direct wizard keeps `Confirmed` and `Stopped`. Decline becomes `Stopped`.
The wizard retains its CLI-control guard, value-free summary, redacted arguments,
sanitized collection errors, and existing cancellation handler.

One shared owner selects and runs the confirmation. A clear replaces the wizard's
generic `Run this command?` question. Other wizard commands retain that question.
Ordinary TUI commands receive no additional question. Instrumented execution starts
after preparation returns executable arguments.

## Behavior and compatibility

The following prompt behavior was observed with disposable HOME directories and the
real terminal helper, except where a cell explicitly names source inspection.

| Input or invocation                  | TUI                                                                               | Direct wizard                                                                     | Explicit CLI                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `database clear TARGET`              | Shows consequences and one default-No question                                    | Shows the same question in place of generic confirmation                          | Executes the existing handler without a prompt                    |
| Enter                                | Declines and returns to the main menu                                             | Declines and exits 0                                                              | Not prompt input                                                  |
| `n`                                  | Declines and returns to the main menu                                             | Declines and exits 0                                                              | Not prompt input                                                  |
| `y`                                  | Runs once and returns to the menu                                                 | Runs once and exits with the handler status                                       | Not prompt input                                                  |
| Escape at confirmation               | Returns to a usable main menu without mutation                                    | Beeps and leaves the question pending                                             | No confirmation                                                   |
| Ctrl+C or Ctrl+D at confirmation     | Exits 0 without mutation                                                          | Exits 0 without mutation                                                          | No new behavior                                                   |
| Literal terminal EOF                 | Source inspection predicts exit 0 without execution. Not independently exercised. | Source inspection predicts `QuitError`, then exit 0. Not independently exercised. | Clear does not read stdin                                         |
| Both stdin and stdout are non-TTY    | Rejects with exit 1 before execution                                              | Rejects with exit 1 before execution                                              | Valid targets execute without prompting                           |
| Only stdin or only stdout is non-TTY | Source inspection of the existing terminal gate predicts exit 1                   | Existing redirected-input and redirected-output acceptance cases verify exit 1    | Clear remains usable with redirected output and no terminal input |
| Malformed generated clear arguments  | Rejects during preparation                                                        | Rejects during preparation                                                        | Existing parser rejects invalid explicit arguments with exit 252  |

Decline and cancellation produce no `Cleared ...` output or TUI `Command completed.`
The telemetry fixture observes no command attempt before wizard consent, no attempt
after decline, and one semantic completion after acceptance. TUI instrumentation
also follows successful preparation, as verified by source inspection.

The installed Effect confirmation also accepts `t` as Yes and `f` as No immediately.
Those aliases are source-inspected. The tests send `y` alone, without Enter, to
verify the actual affirmative interaction.

The terminal helper exposes Ctrl+D but has no separate input half-close operation.
Ctrl+D tests do not establish literal EOF behavior. Disposing a session kills the
child and is not evidence of graceful EOF handling.

## Exact consequence copy

Every row below is followed by `Settings and addon files are preserved.`
The single question is `Clear these saved records?` with `initial: false`.

| Target     | Consequence text                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `aircraft` | This clears all saved aircraft. Saved liveries are kept, with their aircraft links removed. Saved packages, airports, and airlines are kept. |
| `airlines` | This clears all saved airlines. Saved liveries are kept, with their airline links removed. Saved packages, aircraft, and airports are kept.  |
| `airports` | This clears all saved airports. Saved packages, aircraft, airlines, and liveries are kept.                                                   |
| `liveries` | This clears all saved liveries. Saved packages, aircraft, airports, and airlines are kept.                                                   |
| `packages` | This clears all saved packages and their aircraft, airports, and liveries. Saved airlines are kept.                                          |
| `all`      | This clears all saved packages, aircraft, airports, liveries, and airlines.                                                                  |

The table definitions and migration foreign keys establish the consequences.
Package links use `ON DELETE CASCADE`. Livery aircraft and airline links use
`ON DELETE SET NULL`. The existing explicit-CLI fixtures also cover cross-package
liveries, rollback, repeated clears, retained schema, migrations, and sequences.

## Observed terminal transcripts

These excerpts came from the source executable through
`acceptance/support/terminal.ts`. ANSI control sequences and menu frames are omitted.
The active prompt and submitted answer appear on separate lines here for readability.

Direct wizard, packages, followed by Enter. The process exited 0 without clearing.

```text
Command: flightsim-things database clear (values omitted)
This clears all saved packages and their aircraft, airports, and liveries. Saved airlines are kept. Settings and addon files are preserved.
? Clear these saved records? › (y/N)
✔ Clear these saved records? … no
```

TUI, aircraft, followed by `y`. The command ran once. Ctrl+C at the returned menu
then exited the session with status 0.

```text
This clears all saved aircraft. Saved liveries are kept, with their aircraft links removed. Saved packages, airports, and airlines are kept. Settings and addon files are preserved.
? Clear these saved records? › (y/N)
✔ Clear these saved records? … yes
Cleared aircraft from the saved addon database.
Command completed.
```

## Selected design and alternatives

The implementation selects the shared confirmation policy. It centralizes target
recognition, consequence copy, default No, and question selection. Each entry point
retains its own navigation and execution outcomes.

Two independent designs were compared. A separate judge preferred a pure description
helper with local prompts because the entry points already own navigation. The final
selection accepts a small surface selector to keep the one-question rule in one place.
Both alternatives preserve the same database boundary. The comparisons used separate
contexts with the same configured model, so they provide no model diversity.

| Alternative                                          | Decision                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TUI-only question                                    | Rejected because the direct wizard would retain generic destructive copy                                                  |
| Shared pure description with local prompts           | Viable, but repeats default-No and generic-question replacement policy                                                    |
| A second wizard confirmation                         | Rejected because one action would ask for consent twice                                                                   |
| Handler-level confirmation                           | Rejected because explicit CLI scripts must remain deterministic                                                           |
| Consent token or execution wrapper                   | Rejected because preparation already prevents interactive execution before consent                                        |
| Preview counts                                       | Omitted because a preview would acquire or initialize the database before consent and could become stale before execution |
| New force flag, schema changes, or terminal refactor | Outside the bounded change                                                                                                |

The selected scope is the target's full current contents when the transaction starts.
No count claims to describe a fixed snapshot. The existing immediate transaction
continues to own atomic deletion and rollback.

Copy can become stale if foreign keys change. The exhaustive target map catches new
targets at compile time, while SQL fixture assertions cover the existing cascades.
Explicit CLI remains destructive without consent by deliberate compatibility choice.
Wizard Escape retains the installed library's existing beep behavior.

## Fixture setup and verification

`acceptance/database-clear-confirmation.test.ts` uses `createCliFixture()` and
`createTerminalSession()`. Every test gets a disposable HOME and working directory.
No command uses a user's configured database.

The fixture saves its own Community setting with `community-path set`, initializes
the database with `airlines list`, and opens that fixture database with `bun:sqlite`.
It enables foreign keys and inserts one package, aircraft, airport, airline, and
livery. The livery references the aircraft, airline, and package. It snapshots all
five tables, saves the exact configuration bytes, and writes an addon-file sentinel.

For each target and both interactive entry points, the fixture checks the exact copy,
default No, unchanged rows before consent, unchanged rows after Enter, and preserved
settings and addon bytes. Affirmative cases verify target deletion, package cascades,
livery link removal, all other saved columns, and exactly one submitted question.
The wizard cases exercise selection from root, group, and leaf paths.

Additional cases cover `n`, Ctrl+C, Ctrl+D, the distinct Escape behaviors, fresh-HOME
decline without database or settings creation, and nonterminal rejection. Boundary
tests cover malformed generated clear arguments and ordinary TUI approval without a
prompt. Existing wizard tests retain credential masking and generic confirmation.
Two additional wizard cases use local Sentry envelopes to check zero or one attempt.

Run these commands from the repository root after `bun install --frozen-lockfile`.

```sh
bun test src/command-confirmation.test.ts
bun test --cwd acceptance database-clear-confirmation.test.ts
bun test --cwd acceptance --test-name-pattern 'database clear' wizard.test.ts
bun test --cwd acceptance commands/database.test.ts
bun test --cwd acceptance wizard.test.ts tui.test.ts
bun run typecheck
bun run lint
bun run fmt:check
```

Observed results during implementation were 5 passing boundary tests, 36 passing
confirmation acceptance tests, and 2 passing clear telemetry tests. The existing
database baseline passed all 10 tests before the change. Final reruns and the broader
suite are recorded in the PR validation results.

The environment uses Bun 1.4.2 and installed Effect 4.0.2. The vendored Effect source
is 4.0.3. Its Confirm constructor and input handling match the installed version.
The installed terminal quits on Ctrl+C and Ctrl+D. The vendored terminal also quits
on Escape, so its Escape behavior cannot be assumed for this installation.
The TUI supplies its own Escape navigation.

The historic `drizzle-orm/effect-schema` blocker did not recur. The locked
`drizzle-orm` 1.0.0-rc.4 dependency initializes the isolated database successfully.
Vendored repositories and lint rules remain unchanged.
