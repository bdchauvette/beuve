# 0163. Suggest Rename: a language server's rename becomes one note's suggestions

- Status: Accepted; builds on [0162](0162-suggestions-are-a-notes-list-of-replacements.md); amends [0016](0016-in-house-lsp-client-read-only.md) (two more requests)
- Date: 2026-11-27

## Context

"Call this `retryBudget`" is one of the most common review comments, and the most tedious to turn into code: the definition and every use, often across files. Opening an editor on the review-edits branch (ADR 0088) for that is a long detour. beuve already runs the checkout's language servers (ADR 0016, 0111) at the session head, and LSP's rename does not write anything: `textDocument/rename` answers a `WorkspaceEdit`, a list of text edits. With suggestions on any line of any file (ADR 0162), that answer fits a note as it is.

## Decision

- **Command.** Analyze › Suggest Rename… (`suggest-rename`), F2 on both platforms (the VS Code and Zed key), also on the diff line and sheet context menus. It is enabled when the cursor is on a head-side token of a file whose language server advertises `renameProvider` (menu condition `rename-target`). It runs in the main window and in sheets; a sheet hands the result to the main window as `sheet:add-note` does.
- **Requests.** The multiplexer gains `prepareRename` (when the server has `prepareProvider`) and `rename`, both read requests: the client still never sends `didChange` and nothing is written (ADR 0016's rule stands). Client capabilities announce `rename.prepareSupport`. Positions use the negotiated encoding, as hover and definition do. Each request carries its head (ADR 0078), forwards the caller's `AbortSignal`, has a ten-second deadline and is superseded by the next rename.
- **Asking for the name.** A small field at the token, pre-filled with `prepareRename`'s placeholder (or the token), selects it; Return asks for the rename and Escape cancels. A name equal to the old one does nothing. `prepareRename`'s refusal ("cannot rename this element") is shown in place.
- **What is kept from the answer.** `changes` and `documentChanges` text edits are read; resource operations (create, rename, delete a file) are left out and the preview says so. An edit is kept only when its URI resolves, after symlinks, inside beuve's head checkout and names a path tracked in the head's tree (`findTreeBlob`), so install output (`node_modules`, build directories) and files outside the repository never become suggestions; the others are counted in the preview. A server answer is untrusted input: paths are validated as anchors are (ADR 0023).
- **Edits to suggestions.** Main applies each file's text edits to its head blob and splits the result into change regions, merging regions that touch: each region is one suggestion of whole lines. The conversion is pure (`suggestionsFromTextEdits`, in `src/main/lsp`), because it joins the LSP and URA domains.
- **Staging.** A preview lists the files and the number of changes in each, with the left-out counts. Stage creates one note: label `suggestion`, title "Rename `old` to `new`", anchored at the token's line, body empty, its suggestions in path then line order. The note is ordinary from then on: suggestions can be edited or removed one by one, and posting and exports place them by ADR 0162's rules.

## Consequences

A rename across a change is two keystrokes and a name, and the author or agent receives it as concrete edits rather than an instruction. Its quality is the server's: a server that renames text in comments, or misses dynamic uses, produces exactly that. A rename touching lines outside the diff mostly lands in the GitHub review's `<details>` section with permalinks, which is readable but cannot be applied with GitHub's button; agents get all of it. The same pipeline can later take code actions (quick fixes, organize imports), which also answer `WorkspaceEdit`s; that needs its own ADR, because code actions can also run commands on the server.
