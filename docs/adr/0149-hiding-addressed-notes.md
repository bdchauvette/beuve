# 0149. Addressed notes can be hidden from the review dock

- Status: Accepted
- Date: 2026-11-20

## Context

The review dock lists every note of the session: the staged ones in export order, then the withdrawn and addressed ones (ADR 0023, 0144). Over a few rounds of review, addressed notes pile up below the staged ones, and the reviewer scrolls past them to reach the list's end, the review edits and the export buttons. They stay worth keeping (Mark as Not Addressed brings one back), so hiding has to be a view choice, not a status.

## Decision

- **A display preference, `showAddressedNotes`**, on by default, kept in `settings.json` beside the other display preferences (`display:get`/`display:set`, ADR 0042) and validated like them.
- **Review › Note › Show Addressed Notes** (`toggle-addressed-notes`), a checkbox in its own group at the end of the Note submenu, sets it; as with every menu toggle, the Settings window does not (ADR 0068 amendment). Changing it shows a notice that says how to change it back.
- **The dock leaves addressed notes out of its list** while it is off: out of the cursor, the selection and every command that acts on the listed notes. Staged and withdrawn notes are unaffected, as are exports, which never included addressed notes. Below the list, a muted line says how many are hidden ("2 addressed notes hidden.") with a Show button that runs the same command; when every note is addressed, the line starts "Every note is addressed." in place of the empty-dock message.
- Marking a note addressed while they are hidden takes it out of the list at once; the cursor stays at the same place in the list.

## Consequences

The dock can be kept to the notes still in play, and the line under the list means a hidden note is never forgotten. Withdrawn notes cannot be hidden yet; they are rarer, and the same pattern would extend to them. The preference is global, not per session.
