# Releases

Craft comments on PRs with a changelog preview and semantic version impact, refreshed when the PR changes.

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
The release contains four versioned executables, four `desktop.tar.gz` bundles, and `SHA256SUMS`.
Each bundle contains a stable executable filename, a platform launcher, and a README.
The launcher starts `tui`. The standalone executable still prints help with no arguments.
The checksums cover both executables and bundles.
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
The executable and desktop bundle appear in `dist` with the version from `package.json`.
The build uses the host `tar` command to preserve Unix executable permissions.
Run the smoke check on the matching native host:

```bash
bun run verify:binary dist/flightsim-things-0.1.0-linux-x64
```

The check runs version, help, greeting, argument-error, and Community directory persistence commands in isolated user storage.
It also extracts the desktop bundle into a path with spaces, verifies its files, and runs the bundled executable.
The smoke check opens the native launcher in a terminal and selects Exit from its menu.
Native CI runs the interactive acceptance suite against each compiled executable.
To rerun that suite locally:

```bash
FLIGHTSIM_TEST_BINARY=dist/flightsim-things-0.1.0-linux-x64 bun test --cwd acceptance tui.test.ts
```

To generate checksums after building all four targets:

```bash
bun run stage:release dist
```
