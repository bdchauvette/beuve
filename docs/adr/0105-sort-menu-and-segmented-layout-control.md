# 0105. Sort menu and a segmented layout control

- Status: Accepted
- Date: 2026-11-03

## Context

ADR 0099 left the review header with a Path / Imports / Calls selector that was always visible, which cost width for a setting that is rarely changed. Its display controls were three bare icons: a two-button radio group (split, inline) and a whitespace toggle. The three looked alike but behaved differently (the layout buttons are mutually exclusive, whitespace is on or off), and an icon alone did not say which.

## Decision

- **File order is a menu button.** One button shows a sort icon, the current mode's label and a chevron. It opens a `popover` menu (`role="menu"`) of `menuitemradio` items, one per mode, with a check on the current one; choosing one applies it and closes the menu. The fallback warning dot and tooltip (ADR 0099) move onto the button. The menu is anchored to the button with CSS anchor positioning.
- **Layout is a segmented control.** Split and Inline are joined, icon-only buttons in one bordered group (`radiogroup`, each button named by `aria-label` and tooltip); the selected one is filled. A split that does not fit gives the Inline button a dashed inner outline.
- **Whitespace is a toggle button.** An icon button with `aria-pressed`, filled and bordered while on, and standing apart from the joined group: a lone button is a toggle, a joined group is a choice of one.
- The `order`, `layout` and `whitespace` actions, the commands and the menu items are unchanged.

## Consequences

The header spends one button's width on file order and shows the current mode without taking space for the others. Each control now looks like what it does: a joined group for one-of-two, a lone pressed button for on/off, a dropdown for one-of-many. Because the controls are icon-only, their meaning rests on the icons and tooltips. Segmented styles are local to `beuve-diff-stream.ts`; extract shared components if a third place needs them.
