# 0158. The Files tab filters its listing and can show a flat list

- Status: Accepted; amends [0026](0026-radar-tree-and-file-channels.md)
- Date: 2026-11-24

## Context

The Files tab's header spent its row on the word "Files", which the tab above already says, beside the All · Changed toggle. A large listing (All) had no way to narrow it, and the nested tree hides a file's full path behind folders that must be opened.

## Decision

- The header row starts with a filter field in place of the label. It narrows what the current view lists (All or Changed): a path stays when it contains every whitespace-separated term, ignoring case. While a filter is set, the way to every match is opened. Escape clears the filter (then moves into the tree); Enter and ↓ move into the tree.
- A Tree · Flat toggle follows All · Changed. Flat lists every path whole, with no folders.
- `planRadarTree` does the filtering and the choice of open folders, so both are plain functions with tests. `@pierre/trees` has no flat layout, so `beuve-radar-tree` hands it each flat path with `/` replaced by U+29F8 (⧸), which the library does not nest on, and keeps a map from each shown name back to its real path.
- The filter and the layout are the Files tab's own state and are not saved. Neither has a menu item or command; the All · Changed toggle is still View ▸ Changed Files Only (ADR 0068).
- Revealing a file from the palette clears the filter first, so the file is in the list.

## Consequences

- The header does something instead of repeating the tab's name, and a reviewer can find a file by part of its path in a large tree.
- A flat name shows ⧸ rather than `/`. A path that itself contains ⧸ is still found, because lookups go through the map, not by reversing the replacement.
- The library's own search is not used, so matching is ours to change (fuzzy matching, say) without touching the tree.
- A command to focus the filter, and saving the layout, would each be a separate change.
