# Configuration prompts and sample-rate validation

[Issue 46](https://github.com/nsdeschenes/flightsim-things/issues/46) asks how guided configuration can reject invalid values before execution. This report records the comparison, the implemented design, and the application checks.

Users can now correct a bad Sentry DSN or sample rate at the same question. Earlier answers remain in place. Maintainers get one rate parser in [sentry-config.ts](../src/sentry-config.ts) and one collector shared by the direct wizard and terminal menu.

## Existing ownership and framework behavior

[Sentry configuration](../src/sentry-config.ts) already owns the finite, inclusive 0 to 1 schema, DSN validation, and configuration errors. Its locked update reads the latest stored object and preserves unknown properties. [Sentry commands](../src/commands/sentry.ts) previously converted String flags with `Number`, rejecting blank text explicitly, then validated the complete configuration.

The [direct wizard](../src/direct-wizard.ts) confirms execution, rejects CLI control arguments, masks summaries, and stores confirmed arguments in `Redacted`. The [terminal menu](../src/commands/tui.ts) resolves a leaf command before collecting inputs. Escape returns from input to the menu. Ctrl+C and Ctrl+D exit.

The read-only [vendored wizard](../repos/effect/packages/effect/src/cli/internal/wizard.ts) chooses a prompt from each flag's underlying type. `promptParam` runs `param.parse` after `promptSingle` finishes. A schema attached with `Flag.withSchema` therefore does not become prompt-local validation. A failed schema ends collection after submission.

The installed `node_modules/effect/src/cli/Prompt.ts` gives Number prompts a default precision of two decimal places. Its editor normalizes numeric text and rounds before validation. Bounds cannot reject a raw value that rounding has already changed into an accepted value. [Vendored Prompt.ts](../repos/effect/packages/effect/src/cli/Prompt.ts) is the corresponding source reference.

The inspected installation uses Bun 1.4.2, Effect 4.0.2, `@effect/platform-bun` 4.0.2, and `drizzle-orm` 1.0.0-rc.4. The dependency problem mentioned in earlier investigation notes does not occur in this checkout.

## Selected and rejected designs

The comparison evaluated numeric flag declarations and a shared String collector. Terminal experiments rejected numeric prompts because they changed submitted values before validation.

| Approach                                          | Observation                                                                                                                                                               | Decision                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Flag.Finite` with the owner's rate schema        | A value of 2 terminates after submission. The wizard emits 0.12 for 0.123456 and 1 for 1.004. The finite primitive rejects hexadecimal input accepted by the current CLI. | Reject. It loses local correction and numeric compatibility.                                            |
| Bounded `Prompt.Number`                           | Inputs 1.001 and -0.001 become accepted 1 and 0. The input 0.5junk becomes 0.5. Exponent input 1e-3 becomes 13 in the editor.                                             | Reject. Bounds see normalized numbers rather than submitted text.                                       |
| Higher Number precision                           | Raising precision moves the rounding boundary. There is no option to disable rounding.                                                                                    | Reject based on source behavior. No fixed precision preserves existing Number coercion for every input. |
| String flags with only a schema transformation    | Framework parameter validation still runs after the prompt finishes.                                                                                                      | Reject. It does not correct the current question.                                                       |
| A retry around the complete generic wizard        | Collection starts again and discards earlier answers.                                                                                                                     | Reject based on the required interaction.                                                               |
| A copied generic wizard or custom Number editor   | The application would own framework parameter traversal, masking, and numeric editing.                                                                                    | Reject. The change needs only five Sentry fields.                                                       |
| A menu-only collector                             | Direct leaf, group, and root wizards retain different behavior.                                                                                                           | Reject. Every entry point must share collection.                                                        |
| Shared schema-validated `Prompt.String` collector | Raw text reaches the owner parser. The same prompt accepts a replacement after a validation error.                                                                        | Select. Preserve ordinary String flags and delegate other commands to Effect.                           |

The selected tradeoff is text entry instead of numeric arrow controls. JavaScript Number precision remains the numeric contract. This does not add arbitrary decimal precision.

## Implemented contract

The data shape remains the existing configuration object. Optional update fields remain `Option<string>` in the command handler. Omitted values are absent from generated arguments. Explicit zero remains a submitted value.

[command-input.ts](../src/command-input.ts) adds `collect(command, path)`. It handles Sentry set/update and the root/Sentry ancestors needed to reach those commands. It constructs canonical paths once and filters unlisted children. Other groups and leaves continue through `Command.wizard`. Root and Sentry currently have no context parameters to collect.

The owner operation `configurationStore.parseSampleRate` rejects blank text, applies the existing `Number` coercion, and decodes the existing rate schema. Both the handler and the prompt use it. The prompt turns its failure into `Enter a finite sample rate from 0 to 1.` The CLI keeps the existing domain message and exit code. DSN prompts decode `configurationStore.schema.fields.dsn` directly.

The labels and sequential optional Confirm questions remain unchanged. Set asks for every field without defaults. Update asks whether to include each field. Skipping all fields prints `Choose at least one option to update.` and repeats the choices. There is no prompt-time read of saved values.

Collection performs no configuration write and holds no configuration lock. The existing update callback parses submitted values and merges omissions with the latest stored state while the lock is held. The store remains the only persistence owner. The direct wrapper still requires confirmation and keeps its control-argument checks and `Redacted` storage.

The package import map gains `#command-input`, following the existing application aliases. The menu imports `Cause` through its existing Effect dependency to remain within the repository's dependency-count lint rule. Ending its input queue uses `Queue.failCauseUnsafe(queue, Cause.fail(done()))`, the installed implementation of `Queue.endUnsafe`.

The caller usage is small. This sketch omits the existing wrapper's cancellation and execution handling.

```ts
Effect.gen(function* collectInput() {
  return yield* commandInput.collect(command, canonicalPath);
});
```

A guided update that includes only logs generates the equivalent of this ordinary command.

```sh
flightsim-things sentry update --logs 0
```

## Executable experiments

Run commands from the repository root. Both helpers create real child processes. The CLI helper gives each experiment an isolated home. The terminal helper uses `Bun.Terminal` and sends actual keystrokes.

The following candidate experiment compares `Flag.Finite` plus the schema against the generic wizard. Expected behavior was numeric collection followed by schema validation. Observed results were exit 1 for 2, generated 0.12 for 0.123456, and generated 1 for 1.004.

```sh
bun --eval '
import terminal from "./acceptance/support/terminal.ts";
import create from "./acceptance/support/cli.ts";
const root = process.cwd();
const code = `
import {Effect, Console, Schema} from "${root}/node_modules/effect/dist/index.js";
import {Command, Flag} from "${root}/node_modules/effect/dist/cli/index.js";
import {BunServices, BunRuntime} from "${root}/node_modules/@effect/platform-bun/dist/index.js";
const command = Command.make("test", {
  rate: Flag.Finite("rate").pipe(Flag.withSchema(
    Schema.Finite.check(Schema.isBetween({minimum: 0, maximum: 1}))
  ))
}, () => Effect.void);
BunRuntime.runMain(Command.wizard(command).pipe(
  Effect.flatMap(args => Console.log("RESULT=" + JSON.stringify(args))),
  Effect.provide(BunServices.layer)
));`;
for (const value of ["2", "0.123456", "1.004"]) {
  const fixture = await create();
  const session = terminal([process.execPath, "--eval", code], fixture.home, []);
  try {
    await session.waitFor("Rate (--rate)");
    session.send(value + "\r");
    console.log(JSON.stringify({value, exitCode: await session.exited, output: session.output()}));
  } finally {
    await session.dispose();
    await fixture.dispose();
  }
}
'
```

The following executable comparison runs bounded Number prompts and schema-validated String prompts through the same terminal fixture. Observed Number outputs for 0.123456, 1.001, -0.001, and 0.5junk were 0.12, 1, 0, and 0.5. Expected String outputs for 0.123456, 1e-3, and 0x1 were 0.123456, 0.001, and 1. Every invalid String input stayed on its question and accepted Ctrl+U followed by 0.25. The experiment observed those results.

```sh
bun --eval '
import terminal from "./acceptance/support/terminal.ts";
import create from "./acceptance/support/cli.ts";
import {stripVTControlCharacters} from "node:util";
const root = process.cwd();
for (const mode of ["Number", "String"]) {
  const prompt = mode === "Number"
    ? `Prompt.Number({message: "Rate", min: 0, max: 1})`
    : `Prompt.String({message: "Rate", validate: input =>
        Schema.decodeUnknownEffect(rate)(parse(input)).pipe(
          Effect.as(input), Effect.mapError(() => "Enter a finite rate")
        )}).pipe(Effect.map(parse))`;
  const code = `
import {Effect, Console, Schema} from "${root}/node_modules/effect/src/index.ts";
import {Prompt} from "${root}/node_modules/effect/src/cli/index.ts";
import {BunServices, BunRuntime} from "${root}/node_modules/@effect/platform-bun/src/index.ts";
const rate = Schema.Finite.check(Schema.isBetween({minimum: 0, maximum: 1}));
const parse = input => input.trim() === "" ? NaN : Number(input);
BunRuntime.runMain(${prompt}.pipe(
  Effect.flatMap(value => Console.log("RESULT=" + JSON.stringify(value))),
  Effect.provide(BunServices.layer)
));`;
  const values = mode === "Number"
    ? ["0.123456", "1.001", "-0.001", "0.5junk"]
    : ["0.123456", "1e-3", "0x1", "1.001", "-0.001", "0.5junk", ""];
  for (const value of values) {
    const fixture = await create();
    const session = terminal([process.execPath, "--eval", code], fixture.home, []);
    try {
      await session.waitFor("Rate");
      session.send(value + "\r");
      if (mode === "String" && ["1.001", "-0.001", "0.5junk", ""].includes(value)) {
        await session.waitFor("Enter a finite rate");
        session.send("\u00150.25\r");
      }
      await session.waitFor("RESULT=");
      const exitCode = await session.exited;
      const result = stripVTControlCharacters(session.output()).match(/RESULT=.*/)?.[0];
      console.log(JSON.stringify({mode, value, exitCode, result}));
    } finally {
      await session.dispose();
      await fixture.dispose();
    }
  }
}
'
```

An earlier Number exponent experiment timed out waiting for a result after the editor converted 1e-3 to 13 and rejected it. That timeout is a failed compatibility check. The comparison above omits that blocked submission. Standalone experiments establish widget behavior. The committed acceptance suite below proves the complete application behavior.

These commands run the actual application checks and include the isolated fixtures from [cli.ts](../acceptance/support/cli.ts) and [terminal.ts](../acceptance/support/terminal.ts).

```sh
bun test --cwd acceptance sentry-prompts.test.ts
bun test --cwd acceptance sentry.test.ts
bun test --cwd acceptance wizard.test.ts tui.test.ts
bun run typecheck
bun run effect:diagnostics
bun run lint
bun run fmt:check
```

The focused suite passed 17 tests with 114 assertions. Direct Sentry acceptance passed 50 tests. The final source suite passed 237 tests. Existing direct wizard and terminal menu regression passed 99 tests. Typecheck, Effect diagnostics, lint, and formatting checks passed.

The focused tests also read persisted JSON after accepting precision, exponent, hexadecimal, whitespace, zero, and one values. Rejected ordinary values use `--logs=value` to reach domain validation for leading hyphens. Separate `--logs -Infinity` retains the framework's parser-level exit 252. Missing required options also retain exit 252. Domain validation failures retain exit 1.

## Acceptance coverage

The new [Sentry prompt suite](../acceptance/sentry-prompts.test.ts) exercises real commands through both helpers. Existing [Sentry](../acceptance/sentry.test.ts), [direct wizard](../acceptance/wizard.test.ts), and [terminal menu](../acceptance/tui.test.ts) suites supply the unchanged execution and secret-handling checks.

| Behavior                                    | Executable check                                                                 | Observed result                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bad DSN followed by correction              | New direct and menu set cases                                                    | Same DSN question accepts replacement. Final JSON contains the corrected DSN.                                 |
| Blank required rates                        | New direct and menu set cases, every rate field                                  | Each blank is rejected without an implicit zero.                                                              |
| Bad third field retains earlier input       | New direct and menu set cases                                                    | Logs rejects multiple bad values. Final JSON retains the original DSN and precise errors value.               |
| Raw near-bound values, junk, NaN, Infinity  | New direct and menu logs matrix                                                  | 1.001, -0.001, 0.5junk, NaN, Infinity, and blank stay at logs until corrected.                                |
| Zero, one, precision, exponent, hexadecimal | New set, ancestor, and ordinary CLI readback cases                               | JSON contains 0, 1, 0.123456, 0.001, and 1 without prompt rounding.                                           |
| Ordinary whitespace coercion                | New ordinary update readback case                                                | Surrounding whitespace around 0.5 yields 0.5. Blank whitespace fails.                                         |
| Root and Sentry group wizard routes         | New ancestor cases                                                               | Both reach the same correction-capable set and update collectors.                                             |
| Direct and menu update routes               | New selected-update cases                                                        | Only logs changes to explicit zero.                                                                           |
| Concurrent omitted values                   | New selected-update cases change configuration from another process during input | The latest DSN and omitted rates survive. The other process completes while the prompt is open.               |
| Unknown stored properties                   | New selected-update cases                                                        | Extra Sentry/rate properties and unrelated settings survive.                                                  |
| All fields omitted                          | New direct and menu empty-selection cases                                        | Choices repeat before a selected change succeeds.                                                             |
| Ctrl+C and Ctrl+D during collection         | New direct and menu cancellation cases                                           | Exit 0 with saved bytes unchanged.                                                                            |
| Escape during menu collection               | New menu cancellation case                                                       | Return to the menu. A later exit leaves saved bytes unchanged.                                                |
| Decline final confirmation                  | New direct confirmation case                                                     | Exit 0 with saved bytes unchanged.                                                                            |
| Ordinary invalid values                     | New update rejection matrix and existing set tests                               | Domain exit 1, unchanged diagnostic, and saved bytes unchanged.                                               |
| Required CLI options                        | Existing Sentry acceptance                                                       | Parser exit 252 with no write.                                                                                |
| AI provider choices and masked keys         | Existing direct wizard and menu acceptance, including root-selected AI           | Effect continues to collect literal choices and masked secrets. Keys remain absent from summaries and errors. |
| Live Sentry refresh                         | Existing terminal menu and Sentry acceptance                                     | Existing refresh and telemetry behavior remain intact.                                                        |

## Incremental implementation

The implementation plan has three bounded units and their verification checks.

1. Move blank rejection and Number coercion into the configuration owner. Migrate set and update without changing String flags. Verify CLI compatibility with direct Sentry acceptance. Completed with 50 tests passing.
2. Add one shared collector and replace both wizard calls. Preserve generic collection for other commands. Add focused terminal tests, then run existing direct wizard and menu regression checks. Completed.
3. Reconcile this report with observed application results and run static checks. Completed after the final acceptance run.

The implementation kept collection, routing, and acceptance in one change. Configuration updates remain protected by the existing atomic lock. Interactive work remains outside it.

## Boolean audit and limits

`rg -n "Flag.Boolean|Prompt.Toggle|Boolean\\(" src/commands src/*.ts` finds one application Boolean input, [scan --verbose](../src/commands/scan.ts). It defaults to false and is transient. There is no Boolean Sentry or AI configuration field. No toggle or setting was added.

The terminal checks run on Linux with Bun's PTY support. They do not establish Windows terminal behavior or an independently compiled release binary. Numeric values retain ordinary JavaScript binary floating-point precision. No numeric increment controls are added.

Root and Sentry-group dispatch assumes those ancestors have no local parameters, as in the inspected command tree. A future ancestor context flag needs collection before dispatch. The adapter deliberately leaves the remaining parameter and secret machinery with Effect.
