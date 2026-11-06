# 0115. UI primitives: shared style modules, a few behaviour elements, and a gallery

- Status: Accepted
- Date: 2026-11-06

## Context

ADR 0114 put colors and sizes on tokens, but every component still drew its own controls. Buttons were restyled in 16 files with five real variants (bordered, primary, quiet, link, close). Hover changed the border in some files, the text color in others, and nothing in a few. Disabled was 60% opacity in one file and muted text elsewhere, and only the chat drawer had a visible keyboard focus ring. `kbd` had seven copies in three looks, and the status dot was copied three times. Outline pills appeared four times, as `.chip` or `.badge`, and empty states ten times. There were four popover implementations, two of them menus with identical item styles, and two sets of tabs without arrow keys. Relative times were hand-built English ("5 min ago", "yesterday").

## Decision

- **Looks are style modules; behaviour is an element.** Shared looks live in `src/ui/primitives/*-styles.ts`, one Lit `css` export each. A component adds a module to its `static styles` and puts the class on a native element. A real `<button>` keeps its keyboard, form and accessibility behaviour, event delegation (ADR 0074) keeps working, and a long list pays nothing per row. Only what has behaviour of its own becomes a custom element. Wrapping a plain button in a shadow root would cost focus and form semantics for no gain.
- **Style modules:**
  - `buttonStyles`: `.button` (bordered), `.button.primary`, `.button.quiet`, `.button.link`, and `.button.icon` (square and quiet, for × and toolbar icons). Every variant changes its background on hover. Disabled is faint text with no pointer, never opacity.
  - `focusRingStyles`: one `:focus-visible` ring from `--beuve-focus-ring` on buttons, links, form controls and anything with `tabindex`. It is also part of `buttonStyles`.
  - `kbdStyles`, `statusDotStyles`, `badgeStyles`, `emptyStateStyles`, `segmentedStyles` and `menuItemStyles`.
  - Tone is an attribute, `data-tone="ok|warn|danger|accent|merged|muted"`, shared by dots and badges.
- **Elements:**
  - `beuve-menu`: a popover menu. The trigger (`slot="trigger"`) and the items (`role="menuitem"`, `menuitemradio` or `menuitemcheckbox`) stay in the owner's light DOM, so the owner styles them and delegates their events. The element shows the panel with `showPopover({ source })`, which anchors it to the trigger across the shadow boundary (checked in Electron 45). It places the panel with `position-area` and flips it when space runs out. It sets `aria-haspopup` and `aria-expanded`, moves focus with ↑ ↓ Home End, closes on an item's click, and returns focus to the trigger on Escape or light dismiss, which Chromium does not do for a `source`-shown popover.
  - `beuve-tab-list`: `role="tablist"` around slotted `role="tab"` buttons. It keeps a roving `tabindex` and moves with ← → Home End, clicking the tab it lands on (automatic activation), so the owner's click handler stays the only place a tab is chosen.
  - `beuve-time`: renders `<time datetime>` with text from `Intl.DateTimeFormat`, its options as attributes (`date-style`, `time-style`, `year`, `month`, `day`, `weekday`, `hour`, `minute`, `second`, `time-zone-name`). With `format="relative"` it uses `Intl.RelativeTimeFormat` (`numeric`, `format-style`), refreshes itself while connected, and falls back to a date after `relative-until` (default seven days). Its title is always the full absolute time.
  - `beuve-duration`: renders `<time datetime="PT…">` with text from `Intl.DurationFormat` (`format-style`, default `narrow`), balanced as `formatDuration` balances. `style` is a global attribute, hence `format-style`.
  - The formatting is pure functions (`timeTextFrom`, `durationTextFrom`) tested in Node. The elements only read attributes, render and tick.
- **Gallery.** `src/ui/gallery-entry.ts` renders every primitive. It is an entrypoint nothing imports, so no shipped bundle contains it. `scripts/check-gallery.ts` bundles it with esbuild and renders it in a bare Electron window. It saves PNGs per theme and diff scheme with `--screenshots <dir>`, and fails on a console error or a CSP violation.

## Consequences

A component's styles shrink to layout. A control looks and behaves the same everywhere, and a change to a variant is one edit. The class names (`button`, `primary`, `quiet`, `link`, `icon`, `badge`, `kbd`, `status-dot`, `empty`) are reserved in any component that adds the module. A component may still add a local rule for layout, such as width or alignment, but not a new look. A look that recurs becomes a module or a variant, through the gallery. Relative times are now localized, and the `now` state components kept for them is gone. A menu or tab list that needs more than these elements offer (submenus, typeahead) extends the element, not the owner.
