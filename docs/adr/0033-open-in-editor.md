# 0033. Opening the current line in the reviewer's editor

- Status: Accepted
- Date: 2026-10-28

## Context

`o` (spec 5A) should teleport from the diff stream, a dock item or a chat citation to the same line in the reviewer's editor. Launching a process or a URL from a sandboxed renderer is exactly what ADR 0005 forbids, and the reviewer's own checkout is often on another branch (ADR 0020).

## Decision

- **Channel** `editor:open { sessionId, path, line, column? }`, plus `editor:get-settings` and `editor:set-preferred`. `path` is repository-relative and validated like other path inputs (no absolute paths, `..` or NUL). Expected failures are a typed `failed` response (`no-editor-found`, `file-unavailable`, `launch-failed`), not an `IpcError`.
- **Registry** `src/main/editor/editor-definitions.ts`: Zed, then VS Code, then Cursor (the first installed wins unless the reviewer chose one). Zed is invoked as `zed path:line:column` (Zed's CLI documentation); VS Code and Cursor as `--goto path:line:column`. Detection looks on `PATH`, then in well-known locations, because macOS GUI apps don't inherit the shell's `PATH` (`/Applications/Zed.app/Contents/MacOS/cli`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`). With no CLI but a macOS app bundle, main opens `<scheme>://file/<absolute path>:<line>:<column>` through `shell.openExternal`; Zed's documentation doesn't describe that URL form, so it is a fallback only. `isEditorUrl` allows `zed://`, `vscode://` and `cursor://` file URLs and nothing else. Processes start without a shell, detached, with no stdio. A terminal `$EDITOR` and Windows are not supported.
- **Which copy**: the reviewer's working tree only if its `HEAD` is the session head and the file exists there without uncommitted changes (so line numbers match the diff); otherwise beuve's head checkout (ADR 0020), and the status bar says so. The resolved file must lie inside that root after symlinks are resolved.
- **Line**: the selected head lines, else the focused hunk's first changed head line, else the file's first change; selected deleted lines map to their hunk's first change. In the dock the item's current anchor (line 1 for file notes); on a citation pill the cited start line.
- **Preference** lives in `<userData>/settings.json` (`preferredEditor`), a JSON file owned by main, not SQLite: one value, no migrations. `/editor zed|vscode|cursor` sets it, `/editor` shows it, and the keybinding overlay names the current editor.
- **Test hook**: an unpackaged app with `BEUVE_EDITOR_LAUNCH_LOG=<file>` appends each launch as JSON to that file instead of starting anything.

## Consequences

A renderer can only ask to open a file of a session at a line; it can't choose a command or URL. The working-tree rule sometimes falls back to a checkout without `node_modules`, which the status bar explains. Adding an editor is one entry in the registry plus an argv builder.

## Amendment (2026-10-31, task #28): beuve's checkouts are read-only

The TOCTOU audit (finding 3) found that "which copy" sent the editor into the same per-commit checkout that the language servers, chat's sandbox and trace probes read as the reviewed SHA. An edit there silently changed what they describe, and the next head move or startup prune deleted it (`worktree remove --force`).

- **Every beuve checkout is read-only**, not only one opened in an editor: nothing in beuve writes to them. Right after `git worktree add`, on the path's serial chain (ADR 0079), the worktree manager clears the write bits of every file and every directory (`chmodTree`, `#x/fs/chmod-tree.ts`). Directories matter as much as files: editors save by writing a temporary file beside the original and renaming it over, which a writable directory allows whatever the file's mode. Links are never followed or changed (a committed link may point anywhere), and each entry is changed through a handle opened with `O_NOFOLLOW`.
- **Removal opens directories only.** Just before `git worktree remove --force`, on the same chain, the manager gives every directory back its owner's `rwx`. Deleting an entry needs write permission on its directory, never on the entry, so files stay read-only to the end. A failed removal closes the directories again. The startup prune does the same before removing a stale worktree, and deletes stray directories with `removeTree` (`#x/fs/remove-tree.ts`), as does `addWorktree` for a leftover directory at its planned path.
- **Reuse keeps it closed.** A checkout another session reuses is granted as it is. A checkout the startup prune keeps is closed again, so one an older beuve left writable becomes read-only.
- **Trace probes need nothing writable in the checkout.** ADR 0036's runner already writes its config, setup module, reports and Vite and Vitest caches into its own temporary directory, runs with `CI=1` (no snapshot writes) and with coverage off; a test runs it against a read-only checkout. A test that writes beside its own source now fails in the probe, with the error in the probe's output; tests that need scratch space use the inherited `TMPDIR`.
- **The status bar** says "read-only beuve checkout of the reviewed head". To try a change, use Open Review Edits (ADR 0088).

Tests change the bits through `chmodTree` too, and check writes from a separate process (`#testing/attempt-write.ts`), which runs with no capabilities when the tests run as root, since root ignores permission bits. The `tempDir` fixture removes what it holds with `removeTree`.

## Amendment (2026-11-01, ADR 0089): read-only by convention, not enforced

Dependency installs (ADR 0089) run `npm ci`, `uv sync --frozen` and the like directly in beuve's checkout, as in a normal clone, and tools write generated code into dependency directories (Prisma's `.prisma/client`). A sealed tree can't take that, so the seal goes.

- **Checkouts are read-only by convention**: beuve never edits a tracked file in them; installs and tools write untracked output. Nothing clears write bits after `git worktree add`, and nothing reopens directories before `git worktree remove`.
- **Removal still uses `removeTree`** when `git worktree remove --force` fails (a tool can leave read-only directories, such as Go's module files), followed by `git worktree prune`. It is harmless on a writable tree.
- **Checkouts an older beuve sealed** are unsealed once by the startup prune: a kept checkout whose top directory has no owner write bit gets its owner's write bits back on every file and directory (links never followed). Any checkout about to be removed gets the same treatment first.
- **Open in Editor on beuve's checkout** shows one line instead of "read-only": "beuve's checkout at `<short sha>`; edits here aren't kept, use Review Edits", with an Open Review Edits button (ADR 0088). The `editor:open` answer names the head it opened.
- The TOCTOU concern of the first amendment stands, as a convention: an edit in the checkout still changes what the language servers and probes read, and a head move still deletes it. The notice says so; Review Edits is the sanctioned place to edit.
