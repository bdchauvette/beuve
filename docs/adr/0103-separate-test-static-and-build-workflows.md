# 0103. Separate test, static-check and build workflows with a `:ci` script per check

- Status: Accepted
- Date: 2026-11-02

## Context

`ci.yml` ran `npm run check` (typecheck, lint, format, dependency rules, tests) on Ubuntu and macOS, then built and packaged the app. The static checks give the same answer on both systems, so macOS repeated them. A failure said only that `check` failed, and the run took the sum of all the checks. The Homebrew cask lint and the docs formatting check lived in extra workflows with their own path filters (ADR 0094).

## Decision

- **`test.yml`** runs `npm run test:ci` on `ubuntu-latest` and `macos-latest`. `test:ci` adds Vitest's `github-actions` reporter to the default one.
- **`static.yml`** runs on Ubuntu, in parallel, one matrix job per script: `typecheck:ci`, `lint:ci`, `format:ci`, `deps:ci`. They install with `npm ci --ignore-scripts`: none needs Electron's binary or a native build. It has no path filter, so `format:ci` covers prose and `docs.yml` is gone.
- **The Homebrew cask lint** is a job in `static.yml`, not a workflow of its own. A `changes` job diffs the pull request against its base (or a push against `before`) and the lint runs only when `Casks/**` or `static.yml` changed. It runs on Ubuntu with `Homebrew/actions/setup-homebrew`, pinned to a tagged release. A job skipped this way counts as passing for required checks; a workflow skipped by `paths` does not report at all.
- **`audit.yml`** runs `npm run audit:ci` (`npm audit --audit-level=high`: exit 1 on a high or critical advisory in any dependency, dev included, since the dev tree builds what ships). It needs only the lockfile, so no install. It runs when `package.json`, `package-lock.json` or the workflow change, weekly on a schedule, and on demand. It is not in `static.yml` so that a newly published advisory fails the weekly run and the pull requests that touch dependencies, not every unrelated pull request. Moderate advisories are reported, not blocking. The tree has none at high today (36 moderate, all in dev tooling).
- **`build.yml`** (the rest of the old `ci.yml`) builds, renders the hostile-input corpus, runs the terminal check and packages on both systems.
- `test.yml` and `build.yml` keep `paths-ignore` for `docs/**`, `**/*.md`, `LICENSE` and now `Casks/**`. Their lists stay identical. Tests build their own fixtures and never read the docs or the cask; a test that starts to must be added to the lists.
- Each check has a `:ci` script in `package.json` that CI and the release workflow call by name (the release calls only `audit:ci`): `typecheck:ci`, `lint:ci`, `format:ci`, `deps:ci`, `test:ci`. Most are the local command today; the name is the contract, and a CI-only flag goes there without changing the local one. `format:check` is now `format:ci`. `npm run check` stays as the local aggregate that `CLAUDE.md` asks contributors to run; CI does not call it.
- `release.yml` only builds and publishes: it does not repeat the typecheck, lint, format, dependency-rule or test checks, which belong to the pull request and `main` runs, and it calls `audit.yml` (`workflow_call`) as its own `audit` job. The `release` job needs both `build` and `audit`, so nothing is published without an audit that ran for this tag, not the last weekly run. The macOS build runs in parallel with the audit rather than waiting for it.

## Consequences

macOS minutes go to tests, the build and the package only, and a failure names its check. Static checks start in parallel, so the wall-clock time is the slowest one rather than the sum. Each static job pays for its own install, which the npm cache keeps small. Branch protection that requires `check (…)` must instead require `test (…)`, `build (…)` and `static (…)`; the `homebrew (cask)` job can be required too, because it reports as skipped when the cask is untouched. `--ignore-scripts` means a future lint or type rule that needs an install script's output fails in `static.yml`; run that script there or drop the flag for that job.
