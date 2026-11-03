# 0111. Language-server diagnostics in the review UI, and configurable language servers

- Status: Proposed
- Date: 2026-11-03

## Context

A reviewer in an IDE sees exactly where a type or lint error is. In beuve they see nothing, so they cannot tell whether a change compiles without leaving the app. ADR 0106 removed the only reader of language-server diagnostics (the MCP tools), and the code that served them was deleted from `src/main` but its machinery in `src/internal/lsp` is kept. The reviewer wants diagnostics back, in the review UI, for any language whose server speaks LSP. The immediate need is Go, Python is next, and custom servers should be a matter of configuration. No autofix: the client stays read-only (ADR 0016).

What exists today limits this:

- A `ServerDefinition` is already data (ADR 0017), but the registry holds one built-in entry, TypeScript, and maps each file extension to one server.
- Servers come only from beuve itself: its bundled TypeScript pair, or a name looked up on `PATH`. The workspace's own binaries and its own TypeScript are off by default, because a reviewed branch can plant an executable there (ADR 0017).
- Dependencies are the reviewer's to install, in the terminal panel (ADR 0095). That ADR also left open where a file of custom server definitions would live, with one constraint: in the reviewer's own settings, not in the reviewed repository, "since a server is a program beuve starts".

## Decision

### What the reviewer sees

- Diagnostics from the language servers appear on the head side of the diff, from beuve's checkout of the session head (ADR 0020), like hover and go to definition (ADR 0097). A line with diagnostics gets a severity marker; the message, code and source (which server) show in a popover. The file header carries a count, including diagnostics outside the shown hunks. Nothing marks the base side.
- Diagnostics are shown for the lines of the file, not compared against the base. Pre-existing problems on lines the change touches appear too. Comparing base and head is a possible refinement if that proves noisy; it needs a second checkout and server pass and is not part of this ADR.
- No code actions, quick fixes or edits (ADR 0016). Staging a diagnostic as a review note is a natural follow-up and is not decided here.
- Results arrive as the servers produce them. Main keeps the latest report per open document and pushes changes to the renderer, each marked as still checking or settled, instead of one call that blocks on a guess. ADR 0016's settle rules (pull when offered, else the first push report after the latest sync plus a quiet period) decide when "checking" ends; the code they ran in is recoverable from the closed PR that removed it.
- A servers' view of the checkout is only as complete as what is installed there. The popover says so once, in general words ("from `<server>`, in beuve's checkout; install dependencies in the terminal, then Review › Restart Language Servers"), rather than detecting per ecosystem which dependencies are missing (the table ADR 0095 dropped).

### Servers

- **Several servers per file.** The registry maps a file to every server that claims it. Diagnostics are the union over those servers, each tagged with its server id, so a type checker and a linter can both report. Hover, definition, call hierarchy and symbols use the first matching server that advertises the capability, in registry order.
- **Roots.** A server definition may name `rootMarkers` (such as `go.mod`, `go.work`, `pyproject.toml`). A file's server root is its nearest ancestor within the checkout that holds one, else the checkout root. A monorepo with several Go modules gets one server per module root.
- **Servers are data.** A definition is a command, arguments, a map from extension (or file name) to language id, `rootMarkers`, `initializationOptions`, `settings` (answers to `workspace/configuration`), extra environment, and where the program comes from. Beuve ships TypeScript and JavaScript (bundled, as now) and a definition for Go's `gopls`, which beuve does not bundle: it needs the reviewer's Go toolchain. Python and others are configuration or later built-ins.
- **Where the program comes from**, per server, as `source`:
  - `builtin`: shipped with beuve. Only the TypeScript pair.
  - `path`: an absolute command, or a name looked up on `PATH`. The default for everything but TypeScript.
  - `project`: a path relative to the checkout (for example `node_modules/.bin/…`), or for TypeScript, the project's own `tsserver`. This runs code that came with the reviewed branch.
- **`project` is the reviewer's choice and only theirs.** It takes effect only when the reviewer's own configuration asks for it, for the repositories they name. This is the same posture as the terminal (ADR 0095): beuve does not start repository code on opening a review, but the reviewer can decide to. ADR 0017's default (workspace binaries off, TypeScript pinned to beuve's own) stays for everything not opted in.

### Configuration

- **One JSON file, `language-servers.json`, in `userData` beside `settings.json`**, written and read like the other user data (ADR 0082: owner-only, atomic replace). It is hand-edited; Settings gets a button that opens it and the existing Review › Restart Language Servers re-reads it. It is validated with a strict schema (unknown keys and wrong types are errors, as for the model registry in ADR 0070). A missing or invalid file never blocks startup: beuve uses the built-ins and shows the error in Settings and the status bar.
- **`servers`** maps an id to a definition. A built-in id merges field by field over the built-in (so the reviewer can change `gopls`'s arguments or settings), `enabled: false` turns a server off, and a new id defines a custom server.
- **`overrides`** is an ordered list of `{ match, servers }`. `match` is a path glob against the reviewer's own clone of the repository (`~` expands), so one entry can cover a directory of repositories and another a single repository, or a `remote` pattern such as `github.com/owner/*` for pull request sessions, which have no clone of the reviewer's. Entries apply in file order, later ones over earlier ones, merged per server id and per field over `servers`.
- **No configuration is read from the reviewed repository.** A `.beuve/language-servers.json` in a repository would let a pull request choose the programs beuve runs. A later ADR may read one as a suggestion that the reviewer approves; this one does not.

### Order of work

Each step is its own change and ADR amendment where it decides something:

1. Restore diagnostics in `src/internal/lsp`, with the push to the renderer, for TypeScript.
2. The multi-server registry and `rootMarkers`.
3. The configuration file, its schema, overrides and the Settings entry.
4. Go: a `gopls` definition. Before writing it, run `gopls` against a sample module and record what it does: pull or push, which capabilities, which environment variables it needs, whether it touches the network (module or toolchain downloads) and how long it takes to settle on a cold checkout. Those facts decide its default `env`.
5. Python, as the first test of the configuration model with a server beuve does not bundle.

## Consequences

- Reviewers see type and lint errors where the code is, for any ecosystem with an LSP server, with no per-ecosystem logic in beuve beyond a default definition for each language we choose to ship.
- Beuve gains a user-edited config file and a path-matching rule to maintain, and the rule that repository content never defines a program to run. The cost is that a repository cannot carry its own server setup: the reviewer writes it once in their own file.
- `source: project` makes it possible to use the project's own TypeScript, so diagnostics match the project, after the reviewer installs dependencies and opts in. Until then TypeScript diagnostics come from beuve's version and may differ from the project's.
- Servers are found through `PATH`, and a macOS app started from Finder has a minimal one (ADR 0017). A definition can name an absolute command; whether beuve should also resolve names through the reviewer's login shell is open (see below).
- A server per module root and several servers per file mean more processes. The idle shutdown (ADR 0017) bounds that.

## Open questions

- Whether `PATH` lookups should use the reviewer's login-shell `PATH`, which fixes Finder launches but reintroduces the login-shell capture ADR 0095 removed.
- Whether hand-edited JSON in `userData` is findable enough, or the file should live under `~/.config/beuve/` as well or instead.
- Whether sheets pinned to older commits (ADR 0067) also show diagnostics.
- Linters that load the repository's own configuration (ESLint's config is code) belong under `source: project` and the reviewer's opt-in. Whether that is enough, or needs a per-repository confirmation, is left for the step that adds the first linter.
