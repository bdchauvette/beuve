# 0161. Action buttons follow the macOS order

- Status: Accepted
- Date: 2026-11-25

## Context

ADR 0115 defines how buttons look but not where a group's default action goes. Most of beuve's button groups put Cancel first and the primary action last at the end of the row, as macOS does, but the Open panel put its primary action first and at the start of the row, Model settings' Save had no primary styling and Enter did nothing, and the irreversible Discard of review edits looked like any forward action. beuve ships for macOS and Linux (ADR 0048). GNOME also puts the affirmative action last; KDE and Windows put it first, but the renderer can't tell which desktop a Linux build runs under, and beuve doesn't ship for Windows.

## Decision

- A group of actions that confirms, submits or cancels sits at the end of its row (`justify-content: end`), with the secondary actions (Cancel first) before the one default action, which is last. Every platform gets this order.
- The default action is `.button.primary`, or `.button.danger` when it can't be undone (Discard, Remove). `danger` is a new variant of `buttonStyles`: the danger color as a solid fill. There is at most one of either per group.
- In a form, the default action is the form's submit button, so Enter takes it.
- Toolbars (the find bar, the review-edits bar, row actions) aren't confirm groups and keep their own layouts. Native dialogs (`dialog.showMessageBox`) keep the platform's order, which Electron applies.

## Consequences

The order is the same in every window and matches macOS and GNOME. KDE users see the order reversed from their desktop's dialogs; if beuve ships for Windows, or the renderer learns the Linux desktop, a custom property set on `:root` can reverse the row's direction for those platforms without touching the groups.
