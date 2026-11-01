# 0090. One trust grant, an extensible scope, and the lockfile safeguard

- Status: Accepted
- Date: 2026-11-01

## Context

ADR 0036 and 0041 introduced a per-repository approval to run a repository's tests for trace probes, stored in `settings.json` under `traceTrustedRepositories`. Dependency installs (ADR 0089) execute the same kind of code: install scripts of the repository and its packages, with the user's access. The user decided on one grant for both, scoped per repository for now but stored so that branch or author scopes can be added later without a migration, with scripts running normally once trusted. Because a pull request's head can change its lockfile, and trust extends to every later commit (ADR 0041), a trusted repository should still ask before installing dependency changes it hasn't seen, by default.

## Decision

### One grant

- **Wording.** The prompt, `/trust`'s help and the Settings window say: "Trusting lets beuve run this repository's tests and install its dependencies, including their install scripts, on this machine with your access to files and network. It covers every commit you review here, pull requests from other people included." (`src/ui/trust-grant-wording.ts`). With trust granted, scripts run normally.
- **Where it is asked.** The trace portal's inline prompt (the first `r`), Review › Trust Repository… (a dialog, focus on Cancel), the status bar's "not installed: trust this repository to install", and `/trust`. Only renderer channels write a grant (`trust:get`, `trust:set`, `trust:list`, `trust:remove`, renamed from `trace:*-trust`); nothing a model or an MCP client sends can. Granting starts an install for the open session.

### The scope model

- **Stored** in the trust domain's `trust_grants (kind, scope_key, scope JSON, granted_at)`, primary key `(kind, scope_key)`. Today one kind: `{ kind: 'repository', path, remoteUrl? }`, keyed by the real path, matched as ADR 0041 did (the same path and, when a remote URL was recorded, the same URL).
- **Matching** is `doesScopeCover(scope, subject)` over a table of per-kind matchers, and `trustScopeKey(scope)` over a table of per-kind keys; a grant covers a subject when its kind's matcher says so. A `branch` or `author` kind is a new union member, a matcher, a key and rows under its own `kind`: no migration. A row whose kind or JSON this version doesn't understand (a newer beuve's) is kept but matches nothing.
- **Migration.** Nothing real existed yet, so it is straightforward: on first use, `traceTrustedRepositories` in `settings.json` is moved into the table (valid entries become repository grants with their recorded remote) and the key is removed.

### The lockfile safeguard

- **On by default**, with a per-repository switch in Settings (Dependency installs › "Ask before installing when the change modifies dependencies"), stored in `dependency_repository_settings`.
- **Dependency inputs** (`dependencyInputsIn`): any lockfile, manifest or package-manager configuration file of the detection table (ADR 0089): `package.json`, `.npmrc`, `.yarnrc.yml`, `.yarnrc`, `pnpm-workspace.yaml`, `.pnpmfile.cjs`, `bunfig.toml`, `pyproject.toml`, `uv.toml`, `poetry.toml`, `.python-version`, `requirements*.txt`, `composer.json`, `auth.json`, `Gemfile`, `*.gemspec`, `.ruby-version`, `.bundle/config`, `go.mod`, `go.work`, `Cargo.toml`, `rust-toolchain(.toml)`, `.cargo/config.toml`; the toolchain pins `.tool-versions`, `mise.toml`, `.nvmrc`, `.node-version`; and anything under `.beuve/` (ADR 0092). A whole manifest counts, not only its dependency and scripts sections: the simple, conservative choice. Paths under `node_modules`, `vendor`, `.venv` and `target` don't count. Old and new paths of renames both count.
- **The rule.** When the safeguard is on and the session's reviewed range (its review diff: the pull request range, or the interdiff since the last reviewed head) changes a dependency input, an automatic install (session open, trust granted) asks first, even in a trusted repository: the status bar says "safeguard: this change modifies dependencies" with Review Files, Install and Skip; Review Files opens "This change modifies dependencies: <files>. Install and run their scripts?", each file a link to its diff.
- **Answers are per session head** (`dependency_decisions`, cascading from `sessions`): Install and Skip are per-head requests carrying `expectedHeadSha` (ADR 0078). Skip leaves the checkout uninstalled with the status "not installed: skipped at the safeguard"; a later Install still works. The next head asks again only if its own range changes an input. An explicit Install or Reinstall records an `install` answer and runs.
- **A checkout already installed** for another session at the same commit is reported installed: the scripts have already run.

## Consequences

Tests and installs share one decision, so a reviewer trusts a repository once. Old `traceTrustedRepositories` entries keep working after the move. Hostile pull requests in a trusted repository can't run new install scripts without a click, unless the reviewer turned the safeguard off for that repository; they can still change test code, which trace probes run on `r` as before (ADR 0041). Diffing the manifest rather than its sections asks more often than strictly needed (a version bump in `package.json` asks); refining that to dependency and scripts sections is possible later without changing the decision.
