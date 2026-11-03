# 0109. Overview and Files tabs

- Status: Accepted
- Date: 2026-11-03

## Context

ADR 0044 put a pull request's description and the radar tree in one sidebar tab, first called "Intent & files". The two serve different jobs: reading about the change, and moving around its files. The tree wants the whole height, and the description card pushed it down. The word "Intent" also meant little to a reviewer reading the tab strip (ADR 0044's amendment of 2026-11-03 renamed the tab to Overview as a first step).

## Decision

- **Two tabs.** **Overview** holds a pull request's title, state, author, branches, description and stack neighbours (`beuve-pull-request-intent`), then its CI checks (`beuve-pull-request-checks`: the rollup line and every check, worst first, as in the status bar's popover; a check's link opens through `shell:open-url`). **Files** holds the radar tree with its All · Changed toggle.
- **Overview is for pull requests only.** A local review has Files, Review and Chat. A pull request session opens on its Overview, once per session; later the reviewer's own choice stands. If the session is not a pull request, a selection or focus left on Overview falls back to Files.
- **Zones.** The zone ids are `overview`, `files`, `diff`, `ura` and `chat`; `intent` is gone. Next Region visits Overview only for a pull request (`zoneOrderFrom`); the tab list is `sidebarTabsFrom`.
- **Keys (amends ADR 0068).** ⌘1 Overview (menu item enabled only for a pull request), ⌘2 Files, ⌘3 Review, ⌘4 Chat (Ctrl on Linux and Windows). Review and Chat each moved one key along. The `sidebar-files` command is new; `sidebar-overview` keeps its id and now means the Overview tab.
- **Not moved.** The commits since the last review stay in the diff stream: they filter the diff, so they belong beside it.

## Consequences

The tree gets the full height of its tab, and a pull request's description and CI have room to grow (a pull request timeline is a candidate for the Overview). A reviewer who had ⌘2 for Review and ⌘3 for Chat has to relearn them. The sidebar has four tabs on a pull request, one more than before, in a column that is 300 to 380 px wide.
