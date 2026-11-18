# 0115. UI primitives: shared style modules and a few behaviour elements

- Status: Accepted (one diff color scheme since [0114](0114-design-tokens-logical-properties-and-diff-color-schemes.md)'s last amendment)
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
  - `beuve-menu`: a popover menu. The trigger (`slot="trigger"`) and the items (`role="menuitem"`, `menuitemradio` or `menuitemcheckbox`) stay in the owner's light DOM, so the owner styles them and delegates their events. The element shows the panel with `showPopover({ source })`, which anchors it to the trigger across the shadow boundary (checked in Electron 45). It places the panel under the trigger with `position-area`, start-aligned so the options sit under the trigger's text (`align="end"` lines up the end edges instead), and flips it when space runs out. It sets `aria-haspopup` and `aria-expanded`, moves focus with ↑ ↓ Home End, closes on an item's click, and returns focus to the trigger on Escape or light dismiss, which Chromium does not do for a `source`-shown popover.
  - `beuve-tab-list`: `role="tablist"` around slotted `role="tab"` buttons. It keeps a roving `tabindex` and moves focus with ← → Home End. Activation is manual: Enter or Space clicks the focused tab, so the owner's click handler stays the only place a tab is chosen. Automatic activation was tried first, but choosing a sidebar tab moves focus into its panel, which cut the arrow keys short after one press.
  - `beuve-time`: renders `<time datetime>` with text from `Intl.DateTimeFormat`, its options as attributes (`date-style`, `time-style`, `year`, `month`, `day`, `weekday`, `hour`, `minute`, `second`, `time-zone-name`). With `format="relative"` it uses `Intl.RelativeTimeFormat` (`numeric`, `format-style`), refreshes itself while connected, and falls back to a date after `relative-until` (default seven days). Its title is always the full absolute time.
  - `beuve-duration`: renders `<time datetime="PT…">` with text from `Intl.DurationFormat` (`format-style`, default `narrow`), balanced as `formatDuration` balances. `style` is a global attribute, hence `format-style`.
  - The formatting is pure functions (`timeTextFrom`, `durationTextFrom`) tested in Node. The elements only read attributes, render and tick.
- **Catalog.** Every primitive has a Storybook story (ADR 0117), in each theme and diff color scheme.

## Consequences

A component's styles shrink to layout. A control looks and behaves the same everywhere, and a change to a variant is one edit. The class names (`button`, `primary`, `quiet`, `link`, `icon`, `badge`, `kbd`, `status-dot`, `empty`) are reserved in any component that adds the module. A component may still add a local rule for layout, such as width or alignment, but not a new look. A look that recurs becomes a module or a variant, with a story. Relative times are now localized, and the `now` state components kept for them is gone. A menu or tab list that needs more than these elements offer (submenus, typeahead) extends the element, not the owner.

## Amendment 2026-11-06: menus start-aligned, and why buttons stay classes

`beuve-menu` opens start-aligned under its trigger, so the options sit under the text that named them; end alignment put them far from it. `align="end"` remains for a trigger at the end of a toolbar. Storybook (ADR 0117) is the catalog of primitives, and commit hashes became a primitive (ADR 0116).

Asked again whether buttons could be custom elements rendered into the light DOM (`createRenderRoot() { return this; }`, so the inner `<button>` keeps its semantics): Lit can render a light-DOM element, but the owner's own children (the label, an icon) are nodes the owner's template manages. Moving them into the element's `<button>` breaks the owner's template parts, and without a slot there is nowhere else for them to go. A label attribute would lose icons. A customized built-in (`<button is="beuve-button">`) works in Chromium, but it adds nothing a class does not: the styles must still live in the owner's shadow root, because a shadow tree is the only place they reach. Buttons stay native elements with a class. An element is worth it only where there is behaviour, as for the menu, the tab list, times, durations and commit hashes.

## Amendment 2026-11-18: a progress bar

`progressStyles` adds `.progress`, an indeterminate bar that holds still under reduced motion (ADR 0145). It came from the diff stream's opening view, which `beuve-opening` now draws wherever a review is on its way.

## Amendment 2026-11-18: one control height, fields, and a menu separator

The note composer put the label menu's trigger (a `.button`, about 22px: its padding around the text) beside the Title `<input>` (about 27px: its own padding), and the dock's editor did the same; the queue's search, the find bar, the open panel and the setup dialog each sized their inputs by their own padding, so no two rows agreed.

- **A control height.** Buttons and single-line fields take their height from tokens, not padding: `.button` and `.field` are at least `--beuve-size-control` tall (1.75rem), `.small` is `--beuve-size-control-small` (1.375rem) and `.large` is `--beuve-size-control-large` (2rem, new). Padding is inline only and the content is centered, so a field and the buttons beside it line up whatever their fonts. The rule is global, not per row: the default grew a button by about 2px, which the titlebar, the queue header and the diff toolbars absorb (checked in screenshots). The status bar, itself one control tall, and a Cancel inside a line of chat text use `.small`. `.button.link` stays as tall as its text, and an inline button such as `beuve-commit` (`display: inline`) is unaffected.
- **`fieldStyles`** (`src/ui/primitives/field-styles.ts`): `.field` on a native `<input>` or `<select>` (bordered, on the page background, the accent border on focus), with `small` and `large` matching the buttons. Components keep width and, where the text is code (find, paths, commands), the font family. Multi-line `<textarea>`s keep their own sizing. The settings window's inputs, which had the browser's default look, now use it too. `field` is reserved like the button classes; the open panel's wrapper became `.field-row`.
- **One text size per row of controls.** A `.field` takes a button's text size, `--beuve-font-small` (body for `.large`), not the body size inputs default to: the composer's Title sat at body size beside the label menu at small and the code-font body at code size (the same 13px as small). Fields and buttons now share the control font as they share the control height, and the dock's Verdict `<select>` is a `.field` like the rest. Owners that set a field's family (code) keep it.
- **`choiceStyles`** (`src/ui/primitives/choice-styles.ts`): `.choice` on a `<label>` around a native radio or checkbox and its text: the box loses the browser's margin, sits centered on the text and takes the accent (`accent-color: var(--beuve-accent-solid)`) instead of the browser's blue. The settings window's Editors radios and the model settings' radios and checkbox use it. A menu checkbox item standing for several things that differ is `aria-checked="mixed"` with a dash (`menuItemStyles`), as the dock's selection bar shows Blocking over a mixed selection.
- **`.menu-separator`** in `menuItemStyles`: an `<hr>` (role `separator`, which the menu's arrow keys skip) between two runs of items that need no heading, as Blocking under the labels in the note label menu (ADR 0131).
