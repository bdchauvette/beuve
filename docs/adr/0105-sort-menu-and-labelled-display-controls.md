# 0105. Sort menu and labelled display controls

- Status: Accepted
- Date: 2026-11-03

## Context

ADR 0099 left the review header with a Path / Imports / Calls selector that was always visible, which cost width for a setting that is rarely changed. Its display controls were three bare icons: a two-button radio group (split, inline) and a whitespace toggle. The three looked alike but behaved differently (the layout buttons are mutually exclusive, whitespace is on or off), and an icon alone did not say which.

## Decision

- **File order is a menu button.** One button shows a sort icon, the current mode's label and a chevron. It opens a `popover` menu (`role="menu"`) of `menuitemradio` items, one per mode, with a check on the current one; choosing one applies it and closes the menu. The fallback warning dot and tooltip (ADR 0099) move onto the button. The menu is anchored to the button with CSS anchor positioning.
- **Layout is a labelled segmented control.** Split and Inline are joined buttons in one bordered group, each with an icon and a label; the selected one is filled. A split that does not fit marks the Inline label with a dashed underline instead of a dashed border.
- **Whitespace is a checkbox.** A button with `role="checkbox"`, a visible box that shows a tick when on, and the label `Hide whitespace`. It sits beside the segmented control and does not share its look.
- The `order`, `layout` and `whitespace` actions, the commands and the menu items are unchanged.

## Consequences

The header spends one button's width on file order and shows the current mode without taking space for the others. Each control now looks like what it does: a joined group for one-of-two, a ticked box for on/off, a dropdown for one-of-many. The labels widen the display controls a little compared with bare icons. Checkbox and segmented styles are local to `beuve-diff-stream.ts`; extract shared components if a third place needs them.
