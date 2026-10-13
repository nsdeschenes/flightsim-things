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
Help, version, argument errors, and `sentry` configuration commands do not send telemetry.
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

In GitHub Actions, leave **Use workflow from** set to `main` for both release workflows.
Set `target_branch` to the existing branch that receives the release PR. The default is `main`.

Before dispatching, review the target branch's Craft configuration and release hooks.
Preparation runs those hooks with repository write permissions before it opens the release PR.
Use only target branches you trust with that authority.

1. Run **Prepare release**. For a stable release, use `target_branch=main` and choose `auto`, `major`, `minor`, `patch`, or a version such as `0.1.0`.
2. Review the generated `release/<version>` PR into the target branch. Craft updates `package.json` and `CHANGELOG.md`.
3. Wait for **CI** and **Binaries** on the release branch, then merge the PR.
4. Wait for both workflows on the merged target branch commit. Copy the full merged commit SHA.
5. Run **Publish release** with the same `target_branch`, the resolved version without `v`, and that SHA.

To prepare a stable release through the GitHub CLI:

```bash
gh workflow run prepare-release.yml --ref main -f version=minor -f target_branch=main
```

To publish the reviewed release, replace the example SHA with the merged PR commit:

```bash
gh workflow run publish-release.yml --ref main \
  -f version=0.1.0 \
  -f target_branch=main \
  -f release_sha=0123456789abcdef0123456789abcdef01234567
```

For a prerelease from `main`, enter an explicit version such as `1.2.3-alpha.1`, `1.2.3-beta.1`, or `1.2.3-rc.1`.
Prereleases appear as GitHub prereleases and do not become the latest release.

For divergent development, create a branch such as `map-ui` from `main` in GitHub.
Create the branch after this release workflow update reaches `main`, or merge the update into an existing branch before its first release.
Prepare `1.2.3-alpha.map-ui.1` with `target_branch=map-ui`.
Review and merge the release PR into `map-ui`, then publish with the same target and its merged SHA.
A pending release PR into `map-ui` permits a separate stable release PR into `main`.

```bash
gh workflow run prepare-release.yml --ref main \
  -f version=1.2.3-alpha.map-ui.1 -f target_branch=map-ui
gh workflow run publish-release.yml --ref main \
  -f version=1.2.3-alpha.map-ui.1 \
  -f target_branch=map-ui \
  -f release_sha=0123456789abcdef0123456789abcdef01234567
```

As development advances, repeat the process with versions such as `1.2.3-beta.map-ui.1` and `1.2.3-rc.map-ui.1`.
The optional track identifier distinguishes independent releases of the same base version and stage.
It is one lowercase identifier starting with a letter and containing letters, digits, or hyphens.
The track identifier need not match the target branch name.
Versions and iteration numbers have no leading zeros except `0`. Build metadata and other prerelease suffixes are rejected.
Choose each prerelease version explicitly. Craft does not increment its iteration number automatically.
After integrating the development branch into `main`, prepare an explicit stable version such as `1.2.3` on `main`.
Craft generates each changelog from the nearest reachable tag, so merging newer mainline tags into a development branch changes that baseline.

Publication requires a merged release PR into the selected target, the matching manifest version, and successful checks for that exact branch and commit.
The Binaries workflow builds and runs each executable on its native operating system and architecture.
Publication downloads those tested bytes from the verified workflow run.
The release contains four versioned executables and `SHA256SUMS`.
Publication uploads and verifies the assets in a draft before making the release public.

If publication fails after creating a draft, rerun it with the same version, target, and SHA.
The workflow replaces the draft assets with the verified files and reconciles its prerelease flag.
A retry of an already public release verifies its tag, prerelease flag, and assets without changing them.
A public prerelease marked as the latest release fails verification.
A tag that points to a different commit fails publication.

Artifacts expire after 14 days.
GitHub permits workflow reruns only within 30 days of the original run.
Publish before artifacts expire, or restore them within that window.
After that window, prepare a new release.
To restore artifacts, find the target branch's push Binaries run for the merged commit and rerun it:

```bash
gh run list --workflow binaries.yml --branch map-ui --event push --commit <merged-sha>
gh run rerun <run-id>
```

Wait for that run to succeed before publishing again.
If the target branch still points at the merged release SHA, you can run **CI** and **Binaries** manually on that branch.
This also starts checks when a token-created merge does not trigger push workflows:

```bash
gh workflow run ci.yml --ref map-ui
gh workflow run binaries.yml --ref map-ui
```

If preparation pushes a branch but fails to open its PR, inspect the version and changelog on that branch.
Open its PR into the intended target and run both checks on the release branch:

```bash
gh workflow run ci.yml --ref release/<version>
gh workflow run binaries.yml --ref release/<version>
```

The release workflow tests in `bun test` require Bash and `jq`. The CI Ubuntu runner provides both.

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
