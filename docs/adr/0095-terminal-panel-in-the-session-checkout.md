# 0095. A terminal panel in the session's checkout replaces automatic installs

- Status: Accepted
- Date: 2026-11-01

## Context

ADR 0089 to 0092 install a trusted repository's dependencies automatically, from a detection table, with a `.beuve/` configuration file and an install hook. The table is the costly part: every ecosystem is a row with its own toolchain discovery, environment, cache and failure modes, and monorepos need workspace planning on top. The reviewer mostly reviews their own repositories, so they know how each is set up and can run its install command themselves. The user decided to drop detection, the hook and the configuration, and to give the reviewer a terminal in the checkout instead.

The same terminal also covers what installs never did: running a test, a type check or a one-off script against the reviewed head.

## Decision

### The panel

- **A bottom panel of the main window**, under the diff, toggled by View › Show Terminal (`toggle-terminal`). It exists only while a session is open. Closing the panel hides it and keeps its terminals running; closing a terminal tab ends its shell.
- **Terminals belong to a session and a head.** A terminal opens in beuve's own checkout of the session's head (ADR 0020), never in the user's clone. It holds a `session-head` lease for its lifetime (ADR 0079), so the checkout is not removed under it. When the head moves, existing terminals stay on their commit (their tab shows the short SHA) and a new terminal opens at the new head.
- **Several terminals** per session, as tabs. A reloaded renderer lists them again and replays a bounded scrollback (1 MiB per terminal).

### Components

- **`@xterm/xterm`** renders and `@xterm/addon-fit` sizes it, in the renderer's light DOM. The DOM renderer is used: no canvas or WebGL addon, and no CSP change. xterm's stylesheet is bundled into the renderer's CSS.
- **`node-pty`** (1.1.0, N-API, so nothing to rebuild for Electron's ABI) owns the pseudo-terminal in main. It ships prebuilds for macOS but not Linux, where `npm ci` compiles it with node-gyp (the CI image has the toolchain). It is loaded lazily, with a dynamic import, so a missing native binary disables the terminal with a message and never stops the app.
- **A seam between the two.** `src/internal/terminal` holds the pure parts (environment, scrollback, output coalescing) and the `PtySpawner` interface; `src/main/terminal` holds the service and the one file that imports `node-pty`. Tests inject a fake spawner; one test runs a real shell.
- **Output is coalesced** in main (about 8 ms or 64 KiB) and pushed on `terminal:data`. Input, resize and close are invokes. There is no flow control yet: a renderer that cannot keep up buffers in Chromium, and a runaway command is stopped with Ctrl-C or by closing the tab.

### Environment and shell

- **The user's shell, as a login shell** (`$SHELL -l`, else `/bin/zsh` on macOS and `/bin/sh` elsewhere), with beuve's environment minus `ELECTRON_*`, `NODE_OPTIONS`, `CHROME_*` and `ELECTRON_RUN_AS_NODE`. This is the user typing in their own terminal, not beuve running repository code, so the allow-list of ADR 0089 does not apply. Added: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=beuve`, and `BEUVE_CHECKOUT`, `BEUVE_HEAD_SHA`, `BEUVE_SESSION_ID`, `BEUVE_REPOSITORY` (the user's clone: read it, don't write it).
- **Version managers and `direnv`** load their configuration when the shell enters the checkout, as in any terminal. Both ask before trusting a new configuration (`direnv allow`, `mise trust`), which is the decision the user makes here, so beuve adds no trust prompt of its own.
- **The trust grant (ADR 0090) is not consulted.** Nothing runs unless the reviewer types it. Whatever a command writes lands in beuve's checkout, as dependency installs did; the "beuve never edits tracked files there" convention is about beuve's own code, and the reviewer using a terminal is not that. The shell starts in the checkout; where the reviewer goes from there is theirs, as in any terminal.

### Keys

Electron menu accelerators fire before the page sees a key, so Ctrl-B, Ctrl-D, Ctrl-R and the rest of readline would be swallowed on Linux. While a terminal has the focus the window reports the `terminal-focus` menu condition, and main disables every accelerator except the commands that say `keepsInTerminal` (the terminal toggle and the command palette). Disabled items pass their key to the page, where xterm sends it to the shell. The renderer still binds no chord itself (ADR 0068).

### Security

A compromised renderer could call `terminal:open` and `terminal:write`, which is a shell. The renderer already holds channels that lead to code execution (`trust:set`, then installs), so this widens nothing; the renderer's hardening (strict CSP, Trusted Types, no HTML sinks, ADR 0077) is what protects it. Sheet and Settings windows do not get the terminal channels, and `terminal:open` is a per-head channel (ADR 0078). A terminal's data goes only to the main windows.

### What this replaces

Dependency installs end. Detection (`ecosystemRows`), install planning, the install slots, toolchain discovery and the login-shell capture, bundled corepack for installs, the trust-grant gate on installs, the lockfile safeguard, `.beuve/config.json`, the install hook, the Settings override and tool paths, the dependency dialog, status line and menu items, and the `dependency_*` tables are removed; ADR 0089, 0091 and 0092 are Superseded and ADR 0090 keeps only its trust grant. The migration that created the tables never shipped, so it is deleted rather than followed by a drop. Builds from before this change may leave a `deps` directory in `userData`, which stays on `secureUserData`'s list.

The trust grant stays: trace probes still run a repository's tests only under it (ADR 0041), and its prompt now says only that.

Two behaviours that depended on installs change:

- **Language servers** restart for the session head's checkout through Review › Restart Language Servers (`lsp:restart`, `LspMultiplexer.restart`). tsserver does not notice a `node_modules` that appears after it started, so the reviewer restarts after installing; the command also covers a server that misbehaves. Nothing watches the checkout.
- **Trace probes** take packages from the checkout when it has a top-level `node_modules`, else from the user's clone (ADR 0041), instead of "when beuve installed it".

Not decided here: a configuration file for custom language server definitions. `.beuve/config.json` held only install settings and is gone; a later ADR picks where such a file lives (the reviewer's own settings, not the reviewed repository, since a server is a program beuve starts).

## Consequences

A reviewer sets up each head with the commands they already know, and any ecosystem works with no change in beuve. The cost is that nothing installs by itself: types and go-to-definition for a dependency appear only after the reviewer runs the install. A head that moves needs the install again in a new terminal, and then Restart Language Servers, which costs time and disk like a fresh clone did.

`node-pty` brings a native module to build on Linux and ship unpacked from the archive (`asarUnpack`), and its macOS helper and addon are re-signed with beuve's identity like other nested executables (ADR 0085). `@xterm/xterm` is a large dependency, loaded only when the panel first opens. The terminal is a new path to code execution that is gated by the renderer alone.

CI runs `scripts/check-terminal.ts` on Ubuntu and macOS (as it does the hostile-input render): it types into a real shell in the built app under the production CSP and Trusted Types, and checks the checkout, the output, replay after hiding the panel, Restart Language Servers and a shell's exit. `check:packaged` loads the unpacked `node-pty` with the bundled Node.

Deferred: output flow control, search in the terminal, links, split panes, a Windows port, restoring terminals after a restart (a quit ends them), and remembering the panel's height.
