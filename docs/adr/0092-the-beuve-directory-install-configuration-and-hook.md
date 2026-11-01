# 0092. The `.beuve/` directory: install configuration, an install hook, and a Settings override

- Status: Superseded by [0095](0095-terminal-panel-in-the-session-checkout.md)
- Date: 2026-11-01

## Context

Detection (ADR 0089) covers the common case. Some repositories need more: a code generator after `npm ci`, a `make deps`, an ecosystem to leave out, a longer timeout, or a bespoke script instead of the detected installs. The user decided on an escape hatch honoured only for trusted repositories: a plain JSON file, a git-hook-like executable, and a per-repository override outside the repository, with documented precedence.

## Decision

- **Which `.beuve/`**: the reviewed head's own, read from git objects (`.beuve/config.json`) and run from the checkout (`.beuve/hooks/install`). It is honoured only by installs, which run only for trusted repositories (ADR 0090). Every path under `.beuve/` is a dependency input, so the safeguard asks when the reviewed range changes it.
- **`.beuve/config.json`**, parsed with `JSON.parse` and checked with zod (`parseInstallConfig`); unknown keys are errors, so a typo is reported:

  ```json
  {
    "install": {
      "skip": ["python", "pip"],
      "steps": [
        {
          "run": ["npm", "run", "generate"],
          "cwd": "web",
          "env": { "PRISMA_HIDE_UPDATE_MESSAGE": "1" }
        }
      ],
      "hook": "after",
      "timeoutSeconds": 1200
    }
  }
  ```

  - `skip`: ecosystems (`node`, `python`, `php`, `ruby`, `go`, `rust`) or rows (`pnpm`, `pip`, …) whose detected installs don't run.
  - `steps`: argument vectors, run without a shell after the detected installs, in order. `cwd` is relative, normalised, and must stay inside the checkout (no absolute paths, `..`, NUL or backslashes; at run time a directory that resolves outside the checkout through a link never starts). `env` adds variables. A step's executable is found on the install's `PATH` (ADR 0089).
  - `hook`: `after` (default) runs `.beuve/hooks/install` after the detected installs and the steps; `instead` skips the detected installs (the steps and the hook still run).
  - `timeoutSeconds`: the whole install's limit, 10 to 7200 (default 900).
  - An invalid file fails the install with the field and the problem: ".beuve/config.json: install.steps.0.cwd: must be a relative path that stays inside the checkout".

- **`.beuve/hooks/install`**: run, like a git hook, when it is a regular file committed executable (mode `100755`), with the checkout's top level as its working directory, no arguments, the install environment and these variables:

  | Variable           | Value                                                 |
  | ------------------ | ----------------------------------------------------- |
  | `BEUVE_CHECKOUT`   | the checkout's absolute path                          |
  | `BEUVE_HEAD_SHA`   | the commit checked out                                |
  | `BEUVE_SESSION_ID` | the session whose open or request started the install |
  | `BEUVE_REPOSITORY` | the user's clone (read it; don't write it)            |
  | `BEUVE_DEPS_CACHE` | `<userData>/deps/cache`, the shared caches' root      |

  Any language works (a shebang line). Its output goes to the install log; a non-zero exit fails the install.

- **The Settings override**: per trusted repository, Settings › Dependency installs holds a JSON text of the same shape, stored outside the repository (`dependency_repository_settings.install_override`) and validated on save.
- **Precedence**: built-in defaults < `.beuve/config.json` at the reviewed head < the Settings override, field by field within `install`: a field the override sets replaces the checkout's (`steps` is replaced whole, not appended); a field neither sets takes the default. The override is the reviewer's way to correct a repository's configuration without editing it (`{"install": {"steps": []}}` drops its steps). The hook runs whenever the checkout has one; a reviewer who doesn't want it declines at the safeguard or withdraws trust.
- **Order of one install**: the detected units not skipped (none with `hook: instead`), top level first; then `steps`; then the hook.

## Consequences

Repositories can make installs complete without beuve learning their build systems, and reviewers can correct them without editing the repository. Configuration from a pull request takes effect only after the safeguard's question (or with the safeguard off), like any other dependency change. The hook and steps are arbitrary code, as install scripts are; they run only under the trust grant.
