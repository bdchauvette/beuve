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
