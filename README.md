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
If no path is saved or the configuration is invalid, run `community-path set <path>`.

## Check Effect code

`bun install` runs `effect-tsgo patch --typescript --no-oxlint` through `prepare`.
The project pins `@effect/tsgo` to `0.51.1` and TypeScript to `7.0.2`, a supported compiler version for that release.
The patch adds Effect diagnostics to `bun run typecheck`, which runs `tsc --noEmit` in CI and the pre-commit hook.
Effect warnings and errors fail typecheck. Suggestions remain nonfatal.
Only `effect/cli` and `@effect/platform-bun` have an allowance for unstable APIs.

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
