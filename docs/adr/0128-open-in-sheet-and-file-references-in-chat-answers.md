# 0128. Open in Sheet, and file references in chat answers

- Status: Accepted
- Date: 2026-11-10

## Context

Sheets (ADR 0067) open only in their own windows, and only from a definition jump, a peek node or a link in a rendered file. A reviewer in the Files tab (ADR 0109) had no way to read an unchanged file whole, and the chat's answers name files all the time (`src/ui/beuve-review.ts:1311`, "see `path-text.ts`") without validated `[[…]]` citations (ADR 0031). Those names were dead text, and copying one meant selecting it by hand.

## Decision

- **Open in Sheet** (`open-in-sheet`, Review menu, ⌘↩ / Ctrl+Enter, suspended in text fields; context menus of tree rows, diff lines and file headers, and file references). It opens, at the session head: a file reference on its lines, else the tree's focused file, else the diff's target on its head lines (`sheetPlaceFrom`; nothing for a deleted file). It goes through `sheet:open` like every other sheet (ADR 0067's `runSheetAction` `open`).
- **Copy Relative Path** (`copy-path`, Edit menu, no keys; the same context menus but diff lines) copies the repository-relative path of the reference, the tree's file or the diff's file through `clipboard:write-text`. Copy Relative Line Number (ADR 0096) stays the way to copy `path:line`.
- **File references.** A chat answer's inline code span, and a word of its prose (outside links) that has a `.` or `/`, is a reference when `FileReferenceIndex` resolves it: `path`, `path:12`, `path:12-20`, `path:12:5`, `path#L12-L20`, an absolute path whose tail is a repository path, or a tail from a directory boundary that only one file has. The index holds the head tree's paths and the diff's non-deleted files, so prose that only looks like a path stays text, and nothing is linked before the tree loads unless it is in the diff. A reference renders as written, through `pathText`, in a button (`data-action="reference"`, ADR 0074) whose title is the real path; a click asks for a sheet (`beuve-sheet-request`), and a right-click opens the `reference` context menu (a new `ContextKind`). Fenced code blocks and `[[…]]` citations are unchanged: a citation still shows its lines in the diff.
- `MarkdownRenderers` gains optional `text` and `codeSpan` hooks; renderers without them render as before. When the index changes, the transcript's kept Markdown blocks are rebuilt (`MarkdownView.forgetBlocks`).

## Consequences

Any file an answer names is one click from a sheet, and the Files tab can open what it shows. ⌘↩ is taken in the main window outside text fields. A unique bare file name (`beuve-review.ts`) links even when the answer meant something else by it; an ambiguous one does not link at all. Paths are resolved against the head only: a file the answer names at the base side, or one deleted by the change, stays text. The tree's paths are indexed once per tree, with every directory-boundary suffix, which costs memory proportional to the paths times their depth.
