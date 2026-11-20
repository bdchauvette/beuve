# 0152. The menu bar is grouped by concern: Navigate, Analyze and Note menus

- Status: Accepted; amends [0068](0068-native-menus-chorded-keymap-and-a-settings-window.md)
- Date: 2026-11-20

## Context

The Review menu had grown to about 30 entries that mixed six concerns: review progress, writing notes and edits, code analysis, opening things elsewhere, the checkout's environment, and a Note submenu as large as a menu. Plain ⌘-letter shortcuts were running out, but the larger smell was the grouping. IDEs put moving between symbols and listing their relationships in a Go or Navigate menu (VS Code's Go, JetBrains' and Xcode's Navigate) and analyses that draw a view in a Code or Analyze menu. Mac users look under File for opening, reloading, exporting and closing what they work on. In beuve that is a review, not a source file.

## Decision

The menu bar is beuve (app, macOS), File, Edit, View, Navigate, Analyze, Review, Note, Chat, Window and Help. No shortcut changes.

- **File** is the review as a document: Open Pull Request or Branch…, Review Queue; Reload Review, Stop; Open in Editor, Open in Sheet, Open Description in Sheet, Open on GitHub; Export Review ▸, Post Review to GitHub…; Close Window, Close All Sheets.
- **Navigate** replaces Go and adds Show Callers beside Go to Definition and Go to Type Definition.
- **Analyze** holds Show Control Flow, the one analysis that draws a view; later analyses join it.
- **Review** is the reviewer's progress and edits: File Reviewed, Save Progress, Undo Save Progress; Review Range ▸, Filter by Commit…; Suggest Edit…, Review Edits ▸; Checkout ▸ (Run Setup, Edit Setup Command…, Restart Language Servers).
- **Note** is a top-level menu that mirrors the note's context menu (ADR 0150): Add Note, Flesh Out Draft; Show in Diff, Edit…; Label ▸ (the labels, then Mark as Blocking), Status ▸ (Open; Addressed, Withdrawn); Move Up, Move Down; Select All; Show Closed Notes; Delete. Withdraw, Mark as Addressed and Change Label… leave the menu bar. They stay catalog commands for the dock's in-place keys and the palette. On Linux its access key is the O (`N&ote`), since Navigate takes the N.
- **Editor Settings…** moves beside Settings… (the app menu on macOS, Edit on Linux), since it is a preference.

## Consequences

Each menu answers one question, and the menu bar and the note's context menu share one structure. The bar is two menus wider. Analyze has a single item until another analysis arrives. Text that names a menu path ("Navigate ▸ Next Change", "Note ▸ Add Note") follows the new places.
