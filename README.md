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
