# 0104. Presentational components and containers; the app splits into a shell and a review

- Status: Accepted
- Date: 2026-11-02

## Context

`beuve-app.ts` was the renderer's root and held nearly all of its logic: 4,021 lines, 53 `@state` fields and about 250 methods. Moving each concern into a controller (chat, GitHub, the review dock, review edits, the loaded review data, settings) and each small piece of view into an element (titlebar, sidebar tabs, resize handle) took it to about 2,600 lines. What remains is two jobs in one class. One is the window: the sessions list, the Open dialog, the command palette, notices, the status bar, the menus, command routing and the focus zone. The other is the open review: its controllers, the diff stream, the sidebar and the terminal. Command routing reaches into both, which is why neither can shrink alone.

The components below the app already split two ways without a name for it. Some take data and report intent (the dock, the file cards, the open panel, the tabs). Others call the bridge or read the open session (`beuve-terminal-panel`, `beuve-sheet-view`).

## Decision

- **Presentational components** take their data as properties, report intent as events and keep only view-local state (a drag, a hover, a scroll position, a draft). They never call the bridge and never import a controller. Layout components, which arrange other components, compose through **slots**: the container renders the panels into the layout's light DOM, so it keeps owning them, and its `renderRoot.querySelector` and focus lookups keep working across the slot.
- **Containers** own the bridge, the controllers (`src/ui/*-controller.ts`) and the routing between them. A container renders presentational components, passes them data and handles their events. It has little else: no layout CSS, and no logic a controller or a pure function could hold.
- **Two containers.** `beuve-app` is the shell: sessions, the Open dialog, the palette, the shortcuts overlay, notices, the titlebar and status bar, settings, menu state, command routing and the focus zone. `beuve-review` is the open review: the review itself, the controllers that load and change it, the diff stream, the sidebar and the terminal. The shell talks to the review through its public methods (run a command, say what the palette can offer, take focus) and the review reports through events (the review changed, a notice). Neither reads the other's fields.
- **Layout first.** The workspace grid, the sidebar and the dialog frame become presentational layout components now, so the containers lose their layout CSS and markup before any logic moves. The review container then takes the review state and controllers out of the app, and command routing splits by who handles each command.
- **Scripts that drive the built app** (`scripts/check-hostile-render.ts`, `scripts/check-terminal.ts`) reach into the element tree on purpose. They are updated in the same change as any move that breaks their paths, and CI's hostile-render check runs them.

## Consequences

Each file does one of three things (view, state, routing), so a change to the sidebar's look or to what the Review tab counts no longer sits in a 2,000-line class. The slot approach keeps one tree for focus and queries, so zone focus, `:focus-within` and the existing selectors survive the layout move. The cost is another element boundary between the shell and the review: anything both need (the focused zone, the open session, notices) becomes an explicit property or event instead of a field read, and the scripts' paths get one level deeper. Until `beuve-review` exists, `beuve-app` is still both containers; the steps above land one at a time, each with the check passing.
