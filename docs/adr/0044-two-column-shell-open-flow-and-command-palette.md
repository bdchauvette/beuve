# 0044. Two-column shell, one open flow, and a command palette over one command registry

- Status: Accepted; amended by [0068](0068-native-menus-chorded-keymap-and-a-settings-window.md)
- Date: 2026-10-29

## Context

Spec section 4 lays out four zones side by side, each under a 32 px uppercase title bar. Reviewers found the stacked "Open pull request" and "Open local repository" forms in Zone 1 confusing, the title bars a waste of height, and asked for a two-column layout with the sidebar on either side. The common paths are resuming a recent review and opening a pull request someone just linked. Shortcuts were listed in three places (`keybindings.ts`, `/help`, the key handlers) that could drift, and there was no way to search commands, files or staged notes. Three layouts were prototyped on `explore/layout`.

## Decision

- **Shell.** Two columns: the diff stream (Zone 2, flexible) and one sidebar (`--beuve-sidebar-width`, `clamp(300px, 26vw, 380px)`). The sidebar holds three quiet tabs: **Intent & files** (Zone 1: the pull request intent over the radar tree), **Review** with its staged count (Zone 3, the URA dock) and **Chat** (Zone 4, full height beside the diff). `1`, `2` and `3` pick a tab, Tab and Shift+Tab still cycle the zones and the tab follows the focus, `c` opens the chat tab (and goes back to the diff from it), and `\` hides the sidebar. With no session open the sidebar is hidden. This overrides the spec section 4 geometry (four columns, Zone 1 at 260 px).
- **Sidebar side.** The sidebar sits on the right by default. `/sidebar left|right` (also in the palette) moves it, and main keeps the side in `settings.json` as `sidebarSide`, through the display preferences of ADR 0042 (`display:get`, `display:set`).
- **No zone title bars.** A focused zone draws a 2 px accent line along its top edge, and the status bar names the focused region with its main keys (`Diff · j k hunks · m stage …`) instead of "Focus: …". The titlebar shows the open session as a quiet button that opens the open dialog, and a ⌘K hint.
- **Opening sessions** happens in one place, `beuve-open-panel`: the ⌘O dialog, and the main area when no session is open. One input takes a pull request link (Enter opens it in the clone the reviewer last used for that repository, Tab edits the clone first), a folder path, or words that filter recent sessions, newest first; two steps cover the rest. "Pull request…" has a link and a local clone with a folder picker; "Local branch…" has a folder (picker), then head and base suggested from git. The session list and the stacked forms leave Zone 1.
- **Channels.** `repository:inspect { path }` (absolute) returns the repository root, the current branch, a default base (`origin/HEAD`, else `main` or `master`) and branches newest first (`inspectBranches` in the git domain, read-only). `dialog:choose-folder { title?, defaultPath? }` shows Electron's folder picker through an injected platform function, like the clipboard (ADR 0027), answering `chosen` or `cancelled`. The renderer never names a command or path to run.
- **Command registry.** `command-registry.ts` lists every command once: title, scope, shortcut names, chat usage, `/help` text, availability, and what running it does (a shell action, a key pressed in a zone, or a chat command, run at once or typed for the reviewer to finish). The shortcuts overlay (`keybindings.ts`), `/help` (`chat-help.ts`) and the palette read it. `command-registry.test.ts` keeps them in step and checks that every chat command the parser knows and every diff-stream key has an entry.
- **Palette** (⌘K, ⌘⇧P; ⌘P starts in files; Ctrl elsewhere): fuzzy search (`fuzzy-match.ts`) over commands with their shortcuts, recent sessions and open actions, the review's files (changed first, then the head's tracked paths) and staged notes and insights (`plan-palette.ts`, pure). `>` commands, `@` files, `#` open, `!` review narrow it; the footer lists the prefixes. A changed file scrolls the diff to it; another file is revealed in the tree.
- **Rejected layouts.**
  - B, intent and files stacked over the review in collapsible sections with the chat as a drawer under the diff: every section got half the height and the drawer took 280 px from the diff.
  - C, only the intent and the review in the sidebar, files in the palette: it lost the radar tree's at-a-glance neighbourhood and left local sessions with an almost empty sidebar top.

## Consequences

Each zone gains about 32 px of height and the diff gains the width of a column. The chat reads beside the diff, so a citation scrolls the diff while the answer stays visible. The tree and the staged review can't be seen at once; the staged count in the tab label and ⌘P for files make up for most of it. Opening a known pull request is one paste and Enter; resuming is ⌘O, Enter. A pull request whose repository has no earlier session needs the clone chosen once. Running commands from the palette dispatches a synthetic key in the zone, so zone shortcuts keep a single implementation, at the cost of the palette depending on the zones' key grammar. New chat commands and keys must add a registry entry, and the registry test fails until they do.

## Amendment 2026-10-30: menus and chords (ADR 0068)

The single-key shortcuts of this ADR (`1`/`2`/`3`, `c`, `\`, `f`, `?`, Tab and Shift+Tab for zones) are replaced by menu commands with chords (⌘1–3, ⌘L, ⌃⌘S / F9, View ▸ Changed Files Only, Help ▸ Keyboard Shortcuts, ⌃Tab / F6 for regions), and Tab moves focus normally again. The command registry splits into the static catalog in `src/contract/command-catalog.ts`, which main builds the menus from, and the renderer's behaviours per id; the palette runs a command by id instead of dispatching a synthetic key, which removes the cost this ADR accepted. The status bar names the focused region without keys, and the titlebar's ⌘K hint is a "Search or run a command" button.

## Amendment 2026-11-03: the first tab is Overview

"Intent" meant nothing to a reviewer reading the tab strip, so the first tab of a pull request is called **Overview** (a local review's, with no pull request intent, stays **Files**). The View ▸ Sidebar item, its palette entry and the zone name say Overview too. The `intent` zone id and the `sidebar-overview` command are unchanged.
