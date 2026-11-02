# 0099. Newspaper file order, icon display controls and status bar popovers

- Status: Accepted
- Date: 2026-11-02

## Context

ADR 0065 put dependencies before their dependents. In practice that reads bottom-up: the reviewer meets every helper before knowing why it exists, and the files that explain the change come last. Three header and status bar details also confused reviewers: the Split/Inline label sat beside the Path / Imports / Calls selector and looked like part of it; a fallback note (`calls: no calls between the changed files, so imports`) was printed inline next to the selector; and the status bar named the focused region (`diff`) without telling the reviewer anything, while its CI and language-server state could not be inspected and its text could be selected.

## Decision

- **Importers first (amends 0065).** `imports` and `calls` place a file before the changed files it imports or calls: a reverse depth-first post-order, roots and siblings taken in path order, so entry points come first and each file's helpers follow it. An edge that closes a cycle is still ignored, the same way every time. The group label is `Changes, importers first`.
- **Markdown first.** Ordinary changed Markdown files (`.md`, `.mdx`, `.markdown`) form a `docs` group before the changes, in path order and in every mode, because they tend to explain the change. A Markdown file the classifier calls config or mechanical (a pure rename, a formatting-only edit) stays in the last group. The `changes` group gets a divider when `docs` precedes it.
- **No inline error text near the order selector.** When the order fell back, the reason is the selector's tooltip and a small warning dot on the requested mode; nothing is printed beside it.
- **Display controls are icons.** Layout is a two-button radio group (split, inline) and whitespace a toggle, set apart from the order selector by a divider. A split layout that does not fit shows its inline button with a dashed border. The menu and `diff-split`, `diff-inline` and `whitespace` commands are unchanged.
- **Status bar.** The focused-region name is gone (the focus ring and the menus already say where focus is). At the left, a Language servers chip opens a popover listing each server (`lsp:status`: id, checkout, state, open documents, restarts) with a Restart Language Servers button. The CI chip opens a popover of the head's checks, worst first, each a link to its run opened through `shell:open-url`. The bar's text is not selectable, except a notice.
- **`lsp:status`** is a read with no request. It lists every server in the multiplexer, whichever session it serves; the renderer asks when a review loads and when the popover opens, and does not poll.

## Consequences

A reviewer reads the docs and entry points first, then follows imports or calls downward. A helper shared by several importers comes after all of them, so it is not always next to the first file that uses it. The status bar's popovers use the platform `popover` attribute: they close on Escape and on a click elsewhere, and need no listener beyond the delegated actions. The server list can be stale until it is opened; a polled or pushed update can be added without a contract change.
