# Shell completion research

This report answers [issue 44](https://github.com/nsdeschenes/flightsim-things/issues/44). Research ran on Linux with Bun 1.4.2. The recommendation is to enable Effect's built-in static completions for Bash, Zsh, and Fish. Keep dynamic inventory lookup out of this change.

## Dependency evidence

`bun.lock` pins Effect 4.0.2 and `@effect/platform-bun` 4.0.2. Before local installation, Bun resolved an automatically downloaded Effect 4.0.5. That version is not evidence for the application's locked behavior. After `bun install --frozen-lockfile`, this command printed `4.0.2`.

```sh
bun -e 'import p from "effect/package.json"; console.log(p.version)'
```

The exact installed `node_modules/effect/dist/cli/GlobalFlag.js` accepts `bash`, `zsh`, `fish`, and `sh`. The `sh` value generates Bash code. It does not promise POSIX shell support. `powershell` and `pwsh` are invalid values in 4.0.2.

The read-only vendored `repos/effect/packages/effect/src/cli/GlobalFlag.ts` accepts PowerShell and `pwsh` too. That newer source explains the design but cannot establish availability in 4.0.2. The installed `Completions.generate` has no PowerShell branch. An isolated call with `powershell` returned `undefined`.

## Architecture and generated candidates

[The ordinary command registry](../src/commands/ordinary.ts) names the root `flightsim-things`. [The application command tree](../src/commands/index.ts) adds `tui`. Before this implementation, [the entrypoint](../src/index.ts) enabled only `GlobalFlag.Help` and `GlobalFlag.Version` through `CliConfig.layer`.

Effect's `Command.runWith` extracts global flags before normal command validation. It processes configured action flags in order and exits after the first present action. With `[Help, Version, Completions]`, help takes precedence over version and completion. This ordering does not depend on argument order. Global token-extraction errors can still fail before action handling.

`GlobalFlag.Completions` derives a plain `CommandDescriptor` from the root command. The descriptor contains names, descriptions, flags, arguments, and nested commands. The generator reads this metadata rather than invoking handlers. Completion requested after a nested command still generates the full root script.

The installed descriptor implementation preserves command aliases and flag aliases. It omits unlisted commands and hidden flags. Local flags take precedence over inherited flags with the same name. The application currently exposes no root command aliases. Built-in flags are not injected into the descriptor, so generated candidates do not advertise help, version, or completion itself.

Static candidates include root commands, nested commands, `scan --verbose`, `ai set --provider` choices, and literal `database clear` targets. Airport codes, aircraft codes, airline codes, model IDs, and secrets use string metadata. The generator cannot turn those strings into live database candidates.

The descriptor maps path metadata to shell filesystem completion. Directory paths produce directory candidates. File paths produce file candidates. `community-path` currently uses `Argument.String`, so its description alone does not produce directory candidates. Keep that behavior in the initial change. Changing it to `Argument.Directory` needs separate regression checks for relative paths, quoted tilde expansion, nonexistent directories, and current error messages. `src/community-path.ts` already owns those semantics.

## Invocation privacy and failures

[Invocation classification](../src/invocation.ts) originally recognized help and version as controls. [Sentry instrumentation](../src/sentry.ts) excludes controls and sensitive configuration commands from ordinary command spans, logs, and metrics. Completion must join that classification, including malformed completion requests. The shell operand must be consumed when it precedes a command, or the classifier mistakes `bash` for the root command. Inline `--completions=bash` consumes no following argument. Stop scanning after `--` so literal secret values retain their existing meaning.

The existing Sentry wrapper reads configuration before running a command. The completion action itself needs no configuration writes or database access. Merely excluding ordinary command telemetry does not mean the process never initializes the SDK. Tests must distinguish these claims. Retain that startup behavior. Malformed settings can still emit the existing `Sentry telemetry skipped` warning on stderr, as they do for help. Script stdout remains separate from diagnostics.

Sensitive error handling needs an additional change. Effect 4.0.2 returns `CliError.InvalidValue` directly for an invalid shell. Its message includes the supplied shell value. Before this implementation, the generic failure handler printed that message even for sensitive commands. Sanitize every `CliError` for sensitive invocations using the existing generic usage message. Preserve normal failures for ordinary commands. Missing shell values return `ShowHelp`, which the existing sensitive path already handles.

Current exit behavior uses 0 for success, 251 for unknown subcommands, 252 for `ShowHelp` argument errors, and 1 for other failures. Native invalid shell errors therefore exit 1 unless intentionally normalized. Keep the existing mapping and document this distinction in acceptance checks.

## Shell policy and installation examples

Support generated Bash, Zsh, and Fish scripts. Accept `sh` as Effect's compatibility alias for Bash output. State that PowerShell completion is unavailable with Effect 4.0.2. A dependency upgrade and Windows verification are separate work.

These are proposed user instructions, not operations performed during research. No user startup file was changed. Regenerate the same script after upgrading the application because the scripts embed static command metadata.

For Bash, save the script and source it in the current shell. Add the source command to `.bashrc` for later sessions.

```sh
mkdir -p ~/.local/share/flightsim-things
flightsim-things --completions bash > ~/.local/share/flightsim-things/completions.bash
source ~/.local/share/flightsim-things/completions.bash
```

For Zsh, save the autoload file. Add its directory to `fpath` before running `compinit` in `.zshrc`.

```zsh
mkdir -p ~/.zsh/completions
flightsim-things --completions zsh > ~/.zsh/completions/_flightsim-things
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

For Fish, save the script in Fish's completion directory. Open a new Fish session or source the file.

```fish
mkdir -p ~/.config/fish/completions
flightsim-things --completions fish > ~/.config/fish/completions/flightsim-things.fish
source ~/.config/fish/completions/flightsim-things.fish
```

Use the released executable named `flightsim-things` on `PATH`. Windows releases use `flightsim-things.exe`, but PowerShell script generation is unavailable. Desktop launchers always start `tui` and are not completion entrypoints. `bun run start --completions bash` can generate a script from source, but the resulting registration still targets `flightsim-things`. It does not complete the words after `bun run start`.

## Reproduction and observed results

The initial fixture attempts failed before parsing because the local checkout had no installed dependencies. Errors included unresolved `drizzle-orm/effect-schema` and Effect modules under the fixture's temporary `HOME`. After the parent task installed the frozen lockfile, the same fixture ran successfully. These setup failures are not application completion results.

The direct baseline uses the required isolated helper. It creates a temporary home, runs the source CLI there, and removes the fixture afterward.

```sh
bun -e 'import fixture from "./acceptance/support/cli.ts"; const f=await fixture(); try {for(const args of [["--help"],["--completions","bash"],["scan","--completions","bash"],["openaip-key","set","secret","--completions","bad"]]) console.log(JSON.stringify({args,...await f.run(...args)}));} finally {await f.dispose()}'
```

Observed baseline results were as follows.

- `--help` exited 0 with empty stderr.
- Root `--completions bash` exited 251 because `bash` became an unknown subcommand.
- `scan --completions bash` exited 252 for an unrecognized flag.
- The sensitive command exited 252 with the existing generic OpenAIP usage error. Its secret did not appear in the error.

The next experiment enables the proposed built-in on the real application command tree without editing the entrypoint. It omits the application Sentry wrapper, so it proves generator behavior rather than telemetry behavior.

```sh
mkdir -p ~/.cache/agent-work/flightsim-things/issue-44/context
bun -e 'import {Effect} from "effect"; import {CliConfig,Command,GlobalFlag} from "effect/cli"; import {BunServices} from "@effect/platform-bun"; import command from "./src/commands/index.ts"; await Effect.runPromise(Command.runWith(command,{version:"1.0.0"})(["--completions","bash"]).pipe(Effect.provide([BunServices.layer,CliConfig.layer({builtIns:[GlobalFlag.Help,GlobalFlag.Version,GlobalFlag.Completions]})])));' > ~/.cache/agent-work/flightsim-things/issue-44/context/application.bash
bash -n ~/.cache/agent-work/flightsim-things/issue-44/context/application.bash
```

Observed generation and Bash syntax validation both exited 0. Repeating generation with `zsh` and `fish` exited 0 and produced their expected header lines. Inspection found command and flag candidates, provider choices, and database targets. It found no filesystem completion for the Community path string.

The following terminal experiment uses the required terminal helper. The Bash executable is explicit because Bash was the only installed supported shell. The helper itself allocates the pseudoterminal.

```sh
bun -e 'import {homedir} from "node:os"; import terminal from "./acceptance/support/terminal.ts"; import fixture from "./acceptance/support/cli.ts"; const f=await fixture(); const s=terminal(["/usr/bin/bash","--noprofile","--norc"],f.home,["-i","-s","--",homedir()+"/.cache/agent-work/flightsim-things/issue-44/context/application.bash"]); try {s.send("source \"$1\"; echo READY\n"); await s.waitFor("READY"); s.send("COMP_WORDS=(flightsim-things sc); COMP_CWORD=1; COMP_LINE=\"flightsim-things sc\"; _flightsim_things; printf \"ROOT=%s\\n\" \"${COMPREPLY[*]}\"\n"); await s.waitFor("ROOT=scan"); s.send("COMP_WORDS=(flightsim-things scan --v); COMP_CWORD=2; COMP_LINE=\"flightsim-things scan --v\"; _flightsim_things; printf \"FLAG=%s\\n\" \"${COMPREPLY[*]}\"\n"); await s.waitFor("FLAG=--verbose"); console.log(s.output());} finally {s.send("exit\n"); await s.exited; await s.dispose(); await f.dispose()}'
```

Observed output included `ROOT=scan` and `FLAG=--verbose`. Bash printed job-control warnings from the pseudoterminal, then ran both completion functions successfully. This exercises registered completion logic in a terminal rather than simulating a literal Tab keypress. No application executable runs during those function calls.

`command -v bash` printed `/usr/bin/bash`. `command -v zsh`, `command -v fish`, and `command -v pwsh` found no executables. Zsh and Fish runtime smoke tests are blocked by missing shells. PowerShell also lacks generator support. Script inspection does not replace those runtime checks.

One direct Bash function experiment with `database clear air` returned suffixes `craft lines ports`. Keep acceptance assertions on full command and flag candidates until positional replacement behavior receives its own interactive check. This result does not establish a defect in shell insertion behavior.

An exact action-error experiment used `Effect.result(Command.runWith(...))` with the same built-in layer and `renderErrors:false`. The observed cases were as follows.

```sh
bun -e 'import {Effect} from "effect"; import {CliConfig,Command,GlobalFlag} from "effect/cli"; import {BunServices} from "@effect/platform-bun"; import command from "./src/commands/index.ts"; const layer=[BunServices.layer,CliConfig.layer({builtIns:[GlobalFlag.Help,GlobalFlag.Version,GlobalFlag.Completions]})]; for(const args of [["--completions","bad"],["--completions"],["openaip-key","set","secret","--completions","bad"],["scan","--completions","fish"],["--completions","pwsh"],["--help","--completions","bad"]]) {const result=await Effect.runPromise(Effect.result(Command.runWith(command,{version:"1.0.0",renderErrors:false})(args)).pipe(Effect.provide(layer))); console.error(JSON.stringify({args,result:result._tag,error:result.failure?.constructor.name,message:result.failure?.message}));}' > ~/.cache/agent-work/flightsim-things/issue-44/context/experiment-output.txt
```

- `scan --completions fish` succeeded and returned the full root script.
- `--completions bad` returned `InvalidValue` with `bad` in its message.
- `--completions` returned `ShowHelp`.
- `openaip-key set secret --completions bad` returned `InvalidValue`.
- `--completions pwsh` returned `InvalidValue`.
- `--help --completions bad` succeeded because help took precedence.

## Bounded implementation plan

1. Add `GlobalFlag.Completions` after Help and Version in `src/index.ts`. Keep the command tree as the source of generated candidates. Sanitize sensitive native CLI errors before the generic failure-message branch.
2. Extend the existing argument scan in `src/invocation.ts` for a value-taking completion control. Preserve help and version boolean semantics, sensitive-command fallback, inline values, and the `--` boundary. Add focused classifier cases in `src/invocation.test.ts`.
3. Add direct acceptance checks through `acceptance/support/cli.ts`. Cover all supported shells and `sh`, root and nested placement, Help and Version precedence, missing and invalid shells, PowerShell rejection, and sensitive malformed values. Assert clean script stdout, empty success stderr, explicit failure exit codes, no secret echo, and unchanged settings and database files. Check existing files as well as a fresh home.
4. Verify ordinary command telemetry is absent for successful and malformed completion controls. Include a completion request after `tui`, whose current telemetry branch precedes the generic control branch. Use the existing telemetry test mechanism rather than claiming exclusion from source inspection alone.
5. Add a Bash acceptance smoke through `acceptance/support/terminal.ts`. Source generated output in a fresh shell with no startup files, request root and nested flag candidates, and prove the selected handler did not run. Skip unavailable shells explicitly. Add completion checks to `scripts/release.ts` smoke behavior so the compiled executable receives the same proof.
6. Document the supported shell matrix, installation, refresh, source-generation registration name, and PowerShell limitation in `README.md`. Keep this research report as the dependency-specific rationale.

The rejected alternative is an application-owned generator with live airport and aircraft queries. It would add command execution during completion, database lifecycle requirements, and privacy concerns. The native static action supplies the requested command and flag completion without those dependencies. An Effect upgrade solely for PowerShell also exceeds this bounded change.

Remaining risks are Effect CLI's unstable API, missing Zsh and Fish runtime checks in this environment, and filesystem metadata changes accidentally altering path validation. Laziness Protocol kept the design on the existing native action. Prove It Works required the real command tree and Bash terminal experiment, and kept unavailable-shell checks explicit.
