# Flightsim Things

An Electron application with a React interface and SQLite storage for MSFS addons.
The window displays runtime health through a typed, isolated preload API.

## Run locally

Use Node.js 24.13 or newer within Node 24, and pnpm 12.9.1.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Installation downloads Electron through `install-electron`. Linux needs Electron's
system libraries and a graphical session. The native Turso driver supports Linux x64
and arm64, Windows x64, and macOS arm64. Intel macOS needs a different driver.

`pnpm dev` builds the workspace, starts Vite on `127.0.0.1:5173`, and opens Electron.
React and StyleX changes update through Vite. Restart `pnpm dev` after changing the
main process, preload, contract, or database package. Stop both processes with Ctrl+C.
Opening Vite in a browser displays a message to open the desktop app.

To run the production output, run `pnpm build`, then `pnpm start`.

## Package ownership

| Package              | Owns                                                          | Workspace dependencies |
| -------------------- | ------------------------------------------------------------- | ---------------------- |
| `packages/interface` | React UI, StyleX styles, Vite                                 | contract               |
| `packages/electron`  | Main process, sandboxed preload, window and database lifetime | contract, db           |
| `packages/contract`  | `DesktopApi`, `RuntimeHealth`, and the IPC channel name       | None                   |
| `packages/db`        | Drizzle schema, migrations, and addon storage                 | contract               |

The renderer cannot import the database or Node APIs. Its preload API exposes one
method, `getRuntimeHealth()`. Vite allows inline scripts during development for React
refresh. Production keeps `script-src 'self'`. Main accepts requests only from the application's main
frame and expected URL, executes `SELECT 1`, and returns the typed response. New
windows, renderer navigation, and permission requests are denied.

The database lives at `app.getPath('userData')/flightsim.sqlite`. `openDatabase()`
applies pending Drizzle migrations before returning the handle. Table definitions
live in `packages/db/src/schema.ts`. After changing the schema, run
`pnpm --filter @flightsim-things/db db:generate --name=<change>` and commit the
generated SQL and snapshot under `packages/db/drizzle`. That directory ships with
the database package so desktop startup can migrate independently of the working
directory. Library callers use `await openDatabase(path)`, access `handle.db`, and
call `handle.close()` when finished.

## Commands

| Command             | Result                                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `pnpm build`        | Builds contract and db declarations, main, preload, and renderer            |
| `pnpm dev`          | Builds once and runs Vite with the desktop shell                            |
| `pnpm start`        | Opens the built desktop app                                                 |
| `pnpm typecheck`    | Builds shared declarations and checks all packages and desktop tests        |
| `pnpm test`         | Checks SQLite migrations, addon scanning, and persistence                   |
| `pnpm test:desktop` | Checks production and Vite desktop UI, IPC, extracted styles, and isolation |
| `pnpm lint`         | Runs Oxlint                                                                 |
| `pnpm fmt`          | Formats source and configuration with Oxfmt                                 |
| `pnpm fmt:check`    | Checks formatting                                                           |

Build before running the desktop test. On headless Linux, use
`xvfb-run -a pnpm test:desktop`. Containers that cannot use Chromium's sandbox can
explicitly set `SMOKE_NO_SANDBOX=1` for the test runner. Normal application launches
keep the sandbox enabled. CI runs every check above, including the desktop smoke test.

## Reference and license

This foundation adapts the package layout and build conventions of
[nsdeschenes/shop-things](https://github.com/nsdeschenes/shop-things/tree/e729b1c4826c5a096d4cc99f9546a9fa6a22fc12)
at commit `e729b1c4826c5a096d4cc99f9546a9fa6a22fc12` as an architectural
reference. The upstream project uses GPL-3.0-only. This project is licensed under
MIT, copyright 2026 nsdeschenes, as authorized by the owner of both repositories.
The foundation contains no upstream domain features. Third-party dependencies
keep their own licenses.

The installed versions retain React 19.2.8, Vite 8.3.0, StyleX 0.19.1, Electron
44.4.5, Drizzle 1.0.0-rc.4, Turso 0.7.2, tsdown 0.23.0, Vitest 5.0.2,
Oxlint 1.85.0, and Oxfmt 0.70.0 from the reference. All were available from npm.
Node 24 replaces the reference's Node 26.11 runtime download to use the supported
host runtime. TypeScript 6.0.2, also used by the reference interface, is shared by
all packages. pnpm 12.9.1 matches this host. Playwright 1.65.1 provides the desktop
test. Monitoring, domain features, and vendored repositories are not included.

## CI and releases

Desktop application reads the target matrix from `scripts/release-targets.json`.
Linux ARM64, macOS ARM64, and Windows x64 each install dependencies natively, then
run format, lint, type checks, unit tests, and builds in separate jobs. Caches include
the target, OS, architecture, runtime, and dependency manifests. Native dependencies
never cross operating systems. Windows caches the pnpm store and installs from the
lockfile in each job to recreate native dependency links. Desktop smoke and package proof reuse only their
own target's same-commit build, identified by its full SHA.

The final acceptance jobs require every target's checks to pass. Staging requires
exactly one installer and native smoke proof per target, all for the same SHA and
version. It verifies the tested bytes before publishing the complete artifact set
with `SHA256SUMS`. Script tooling tests version bumps, complete staging, and rejection
of missing, duplicate, changed, or foreign artifacts and evidence.

Craft 2.33.1 manages automatic versions and changelogs. Enable Actions write
permissions and **Allow GitHub Actions to create and approve pull requests** in
repository Settings > Actions > General. No additional release token is needed.

1. Dispatch **Prepare release** from `main`, choosing `auto`, `major`, `minor`,
   `patch`, or a stable version without `v`.
2. Review the generated `release/<version>` PR. Preparation dispatches Desktop
   application and Script tooling explicitly because `GITHUB_TOKEN` cannot trigger
   ordinary push or pull-request runs. Require both successful runs before merging.
3. Squash-merge the release PR. Wait for both push workflows on the resulting full
   `main` commit SHA to pass.
4. Dispatch **Publish release** from `main` with that version and full SHA.
   Publication requires synchronized versions, main ancestry, the merged release
   PR, successful push runs, and staged assets from that exact desktop run. Craft
   publishes a `v<version>` GitHub release containing the tested Linux ARM64 Debian
   installer, macOS ARM64 DMG, Windows x64 NSIS installer, and `SHA256SUMS`. It does not rebuild the application.

Changelog preview uses Craft's pinned reusable workflow. Release preparation and
publication share a concurrency group. Assets expire under the repository artifact
retention policy; rerun the original main push run of Desktop application if they have expired.
A manual dispatch validates acceptance but does not stage publishable assets.

For local package verification on a supported native host, run `pnpm build`, then
`pnpm package:desktop`. Save `git rev-parse HEAD` in a file outside the repo and
set `BUILD_COMMIT_FILE` to that file when running `pnpm test:package`. On headless
Linux, use `xvfb-run -a pnpm test:package`. Packaging refuses a foreign host platform
or architecture. Local Linux x64 is not a release target.

The package smoke check extracts the Debian installer, mounts the DMG and copies
its app, or silently installs NSIS into a temporary directory. It verifies the
package architecture and bundled MIT license, launches the installed executable,
and checks database health through isolated IPC. Temporary installations are removed
after the application closes. macOS uses the native `macos-15` ARM64 runner; Windows
uses `windows-2025` x64. Intel macOS, Windows ARM64, and Windows 32-bit are not targets.
The database driver remains unchanged.

Windows installers have no publisher signature. macOS uses ad hoc signing for
Apple Silicon execution, without a Developer ID signature or notarization. No signing credentials are configured. Gatekeeper and
Windows SmartScreen can warn or block downloaded applications. CI verifies the
local packaged payload, not acceptance by these distribution trust services.
The package uses Electron's default icon until product artwork exists.
