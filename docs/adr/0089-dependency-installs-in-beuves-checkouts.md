# 0089. Dependency installs in beuve's checkouts, detected from a table

- Status: Accepted
- Date: 2026-11-01

## Context

beuve's per-commit checkouts (ADR 0020) have no dependencies installed. tsserver therefore types every import from a package as `any` and can't go to a dependency's definition, and trace probes take `node_modules` from the user's clone, which may not match the reviewed head's lockfile (ADR 0041). The design research (2026-10-31) proposed a detached, content-addressed cache linked into sealed checkouts. The user rejected that storage design and decided: install directly in beuve's own checkout, exactly like a normal clone; checkouts are read-only by convention only (ADR 0033 and 0079 amendments); one trust grant covers installs (ADR 0090); detection is a data table, covering every common ecosystem from the start; toolchains are the host's.

## Decision

### Where and when

- **In the checkout.** The install runs the tool's frozen, lockfile-only command with the unit's directory of beuve's checkout as its working directory, as a developer would in a clone: `node_modules`, `.venv`, `vendor/` and generated code (Prisma's `.prisma/client`) land there, untracked. beuve still never edits a tracked file.
- **When.** When a session opens on a trusted repository (main's `getReview` hook, so MCP sessions too), after the checkout is leased, and when the reviewer grants trust. Untrusted repositories install nothing. Install, Reinstall and the safeguard's Install also start one.
- **One install per checkout**, shared by every session at that commit. The state is stored per checkout path in `dependency_installs`: `pending` (waiting for a slot), `running`, `done`, `failed` (with the reason) or `declined`, with the tools and versions used and the log's tail. A session's view adds `untrusted`, `nothing` (no lockfile, step or hook), `needs-approval` and `not-installed`. The worktree manager's `onCheckoutReset` (fresh add, removal, prune) drops the row and the log, so a recreated checkout is never reported as installed. At startup, rows left `pending` or `running` become `failed` ("interrupted: beuve quit"). A failed install is retried only on request, never automatically on the next open.

### Detection is a table

`ecosystemRows` (`src/internal/deps/ecosystem-rows.ts`) maps well-known files to a row: its ecosystem, its lockfiles (and an optional condition on the directory), the manifests and package-manager configuration that are its dependency inputs (ADR 0090), its isolated cache, and its candidate executables with their install steps and environment. `detectInstallUnits` reads one `git ls-tree -r` of the head (never the checkout) plus the `package.json` and `pnpm-workspace.yaml` of directories with a Node lockfile, and takes, per directory and ecosystem, the first row whose lockfile is there.

| Row          | Selected by                                                  | Frozen install (in the unit's directory)                                                          | Toolchain                      | Cache (under `<userData>/deps/cache`)  |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------- |
| pnpm         | `pnpm-lock.yaml`                                             | `pnpm install --frozen-lockfile --store-dir <cache>`                                              | corepack (ADR 0091)            | `pnpm-store`, shared content-addressed |
| bun          | `bun.lock`, `bun.lockb`                                      | `bun install --frozen-lockfile`                                                                   | host `bun`                     | `bun` (`BUN_INSTALL_CACHE_DIR`)        |
| yarn berry   | `yarn.lock` with `.yarnrc.yml`, or `packageManager: yarn@2+` | `yarn install --immutable`                                                                        | corepack                       | `yarn-berry` (`YARN_GLOBAL_FOLDER`)    |
| yarn classic | `yarn.lock` otherwise                                        | `yarn install --frozen-lockfile --non-interactive --cache-folder`                                 | corepack                       | `yarn-classic`                         |
| npm          | `package-lock.json`, `npm-shrinkwrap.json`                   | `npm ci --no-audit --no-fund --cache <cache>`                                                     | corepack                       | `npm`                                  |
| uv           | `uv.lock`                                                    | `uv sync --frozen`                                                                                | host `uv`                      | `uv` (`UV_CACHE_DIR`)                  |
| poetry       | `poetry.lock`                                                | `poetry install --no-interaction` (venv in the project)                                           | host `poetry`                  | `poetry` (`POETRY_CACHE_DIR`)          |
| pip          | `requirements*.txt` (when neither lock is there)             | `uv venv .venv`, then `uv pip install --python .venv -r <file>` each                              | host `uv` (cheap only with uv) | `uv`                                   |
| composer     | `composer.lock`                                              | `composer install --no-interaction --no-progress`                                                 | host `composer`                | `composer` (`COMPOSER_CACHE_DIR`)      |
| bundler      | `Gemfile.lock`                                               | `rv ci` when rv is installed, else `bundle install`; `BUNDLE_FROZEN`, `BUNDLE_PATH=vendor/bundle` | host `rv`, else `bundle`       | `bundler` (`BUNDLE_USER_CACHE`)        |
| go           | `go.sum` beside `go.mod`                                     | `go mod download`                                                                                 | host `go`                      | `go-mod` (`GOMODCACHE`)                |
| cargo        | `Cargo.lock`                                                 | `cargo fetch --locked`                                                                            | host `cargo`                   | the user's `~/.cargo` (see below)      |

- **Workspaces** are installed once, at their root: a Node unit inside another Node unit's `workspaces` (array, or `{ packages }`, with `!` exclusions) or `pnpm-workspace.yaml` `packages` is a member, reported and skipped. Nested independent projects are units of their own; units run top level first.
- **Ignored**: links (a committed link is never a lockfile), and anything under `node_modules`, `vendor`, `.venv`, `target` or `.git`.
- **Adding an ecosystem** is a row, plus a toolchain finder if it needs a new kind (today `corepack` and `host`).
- **A missing tool** fails the install before anything runs, naming every missing row and how to get it ("bun not found (for bun). Install bun (https://bun.sh), or set its path in Settings."). Nothing installs partially.

### Toolchains, on the host only

- **Node package managers** run on beuve's resolved Node (ADR 0083) through the bundled corepack (ADR 0091), which honours `packageManager`.
- **Every other tool** is searched, in order: the directory Settings names for that executable (it also overrides corepack for its tool); the `PATH` of a login-shell capture; well-known and version-manager directories (Homebrew, `~/.local/bin` for uv, rv, mise and pipx, `~/.cargo/bin`, `~/.bun/bin`, volta, the shims of mise, asdf, rbenv and pyenv, fnm's default alias, composer's global bin, Go's); beuve's own `PATH`. uv finds and manages its own Pythons.
- **The login-shell capture** runs `$SHELL -i -l -c 'printf marker; env'` once per launch (cached), from `$HOME`, never in a reviewed directory, so `chpwd` hooks (mise activate, direnv) can't load a reviewed repository's configuration. stdin is closed, the environment minimal, and its process group is killed after 10 s. It keeps `PATH` and version-manager variables (`MISE_*`, `ASDF_*`, `VOLTA_HOME`, `FNM_*`, `UV_*`, `RV_*`, `GOPATH`, `CARGO_HOME`, …). On failure beuve logs it and uses the other directories.
- **The version** each tool reports (`--version`, in the unit's directory, so corepack resolves `packageManager`) is recorded with the install.
- Version-manager shims run in the checkout like any tool, so a trusted repository's `.tool-versions` or `mise.toml` picks the version, as in a clone. mise refuses untrusted configuration on its own.

### The environment

An allow-list of beuve's environment (home, user, shell, temp, locale, `TZ`, proxy and CA variables, `SSH_AUTH_SOCK` for git dependencies, XDG directories), the login shell's tool variables, `PATH` per tool, `CI=true`, corepack's no-prompt flags, no colours, and beuve's own: `BEUVE_CHECKOUT`, `BEUVE_HEAD_SHA`, `BEUVE_SESSION_ID`, `BEUVE_REPOSITORY` (the user's clone), `BEUVE_DEPS_CACHE` and `COREPACK_HOME`. Tokens in beuve's environment are not passed; the user's own `~/.npmrc`, `~/.config/uv` and the like still apply through `HOME`. Env values are never logged.

### Running, cancelling, limits

- Each step runs without a shell, stdin closed, in its own process group. An install is not git, but follows ADR 0079's `owned-write` policy: an abort sends SIGTERM to the group and SIGKILL after a 5 s grace, and the step answers once the process has exited. A step whose directory resolves outside the checkout (a committed link) never starts.
- **Slots**: one install per repository and two in all; the rest wait as `pending`.
- **Timeout**: 15 minutes for the whole install, or the configuration's `timeoutSeconds`; reported as a timeout, not a cancel.
- **What stops one**: Cancel (Review › Dependencies › Cancel Install), quitting, and a head move that leaves no waiting session at that commit. The install holds a `session-head` lease, so its checkout can't be removed under it.

### Caches and logs

- Isolated package-manager caches under `<userData>/deps/cache/<row cache>`, shared across checkouts and repositories, created 0700; `deps/` is on `secureUserData`'s list (ADR 0082). pnpm's store gives the most reuse. Cargo keeps the user's `~/.cargo`, because `CARGO_HOME` also holds its configuration, credentials and rustup's proxies.
- One log per checkout, `<userData>/deps/logs/<repo>-<hash>/<commit>.log`, created 0600 without following links, truncated per install. It records each step's argument vector, label and directory and all output. View Install Log shows its last 512 KiB, revealed (ADR 0082); the stored row keeps its last 4,000 characters.
- Disk: checkout removal removes the install with it, as before. Sizes are not reported yet.

### Integrations

- **Language servers**: after an install finishes, the checkout's servers are stopped (`LspMultiplexer.restart(root)`) and start afresh on the next request; tsserver doesn't notice a `node_modules` that appeared after it started (research). ADR 0017 is unchanged: beuve's own TypeScript, never the workspace's binaries.
- **Trace probes** take packages from the checkout once beuve installed it and it has a top-level `node_modules`, else from the user's clone as before (ADR 0041). The runner's scratch `node_modules` is still a directory of links (ADR 0036 amendment), so nothing writes into either.
- **Pyright** doesn't detect `.venv` on its own (research): a Python language server, when one is configured, must be given `venvPath`/`venv` (or `python.pythonPath`) for the checkout. beuve has none yet; this is recorded here for it.

## Consequences

Types, definitions and probes come from the reviewed head's own lockfile, for every ecosystem with a host tool. Installs execute the repository's and its dependencies' install scripts with the user's access, which the trust grant and the safeguard gate (ADR 0090). A checkout is now as large as a clone with its dependencies (beuve's own is about 700 MB), per commit under review; the pnpm store and the shared caches reduce download, not disk. Monorepos with nested lockfiles install every unit, not only the ones a request touches. Bundler without rv evaluates the `Gemfile` (Ruby code) like any `bundle install`.

"Scripts run normally" means what the tool does in a terminal: corepack's default npm when a repository pins none (12.2.1 in the smoke run) blocks dependency install scripts that the project's `allowScripts` doesn't list, and pnpm 10 builds only `onlyBuiltDependencies`; beuve doesn't override either, and the log shows what was blocked.

Deferred: reporting checkout sizes, a disk budget, waiting for an in-flight install from a probe, yarn PnP's tsserver SDK, a Python language server with venv settings, Windows.
