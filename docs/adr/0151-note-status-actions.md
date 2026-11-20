# 0151. Notes change status through three named actions, from any status

- Status: Accepted; amends [0023](0023-universal-review-artifact-model-and-exporters.md), [0027](0027-ura-note-list-keyboard-clipboard-and-outdated-items.md) and [0144](0144-note-names-by-state-menu-icons-and-bulk-notes.md)
- Date: 2026-11-20

## Context

ADR 0023 drew a note's lifecycle as `staged → addressed | withdrawn`, and back to `staged` to undo, and `transitionUraItem(item, to)` enforced it: addressed and withdrawn never turned into each other directly. No ADR gave a reason, and none holds up. The one real rule is about addressing: it records the head and who judged the note fixed, and that head cannot be the one the note was written against. That rule does not depend on the status the note came from. Meanwhile a reviewer may well say "this was addressed, but I'm withdrawing it after all", or "I withdrew this, but it has actually been fixed".

The way status changed was also close to CRUD: `ura:transition { to }` and `ura:edit-many { change: { kind: 'status', to } }` set a field, and ADR 0150's Status submenu had main restore a note and move it on to get around the rule.

## Decision

- **Three domain actions** in `src/internal/ura`, each its own function with its own rule:
  - `withdrawUraItem(item, now)`: the reviewer drops the note; from staged or addressed.
  - `markUraItemAddressed(item, { atSha, by, now })`: a reviewer or an agent judges it fixed at a later head; from staged or withdrawn. `validateUraItem` still refuses the head it was written against.
  - `reopenUraItem(item, now)`: puts a closed note back among the staged ones.
    Each refuses a note already in its status (`invalid-transition`). `withUraStatus` builds and validates the changed item for them; `transitionUraItem` is gone.
- **The wire carries the action, not the status.** `ura:edit-many`'s change is `{ kind: 'withdraw' }`, `{ kind: 'mark-addressed' }` (by the reviewer, at the session's current head, as before) or `{ kind: 'reopen' }`, beside the label and Blocking changes; notes already in the resulting status are left alone. `ura:transition`, which the renderer no longer called, is removed; one note is a batch of one.
- **Withdraw and Mark as Addressed act on every note not yet in that status**, staged or in the other closed status, rather than on the staged ones only (ADR 0144); when every note has the status already, they reopen them all, as before. The context menu's Status submenu (ADR 0150) maps Open, Addressed and Withdrawn to the three actions.
- The status names are unchanged: the domain still calls an open note `staged`, which the database's check constraint lists. Renaming it to match the UI's "Open" would take a migration and is left for later.

## Consequences

A closed note moves between addressed and withdrawn in one step, and each action states its own precondition, so the next rule (say, that only an agent may address a note it proposed) has an obvious home. Callers say what happened, not which value to store. A batch that marks notes addressed still fails as a whole when one of them was written at the current head.
