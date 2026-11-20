# 0149. Closed notes can be hidden from the review dock

- Status: Accepted
- Date: 2026-11-20

## Context

The review dock lists every note of the session: the staged ones in export order, then the withdrawn and addressed ones (ADR 0023, 0144). Over a few rounds of review, those pile up below the staged ones, and the reviewer scrolls past them to reach the list's end, the review edits and the export buttons. They stay worth keeping (Restore and Mark as Not Addressed bring one back), so hiding has to be a view choice, not a status.

Hiding needs one name for both. "Resolved" is taken: other reviewers' GitHub threads are resolved or not (ADR 0140), and the Blocking toggle says a blocking note "must be resolved before merging", which means addressed. A withdrawn note is not resolved in that sense.

## Decision

- **Withdrawn and addressed notes are _closed_**, as GitHub issues are closed as completed or as not planned. A staged note is open. The word names the pair in the UI; the statuses keep their names.
- **A display preference, `showClosedNotes`**, on by default, kept in `settings.json` beside the other display preferences (`display:get`/`display:set`, ADR 0042) and validated like them.
- **Note › Show Closed Notes** (`toggle-closed-notes`), a checkbox in its own group of the Note menu (ADR 0152), sets it; as with every menu toggle, the Settings window does not (ADR 0068 amendment). Changing it shows a notice that says what closed means and how to change it back.
- **While it is off, the dock lists only the staged notes**: closed notes leave the cursor, the selection and every command that acts on the listed notes. Exports never included them. Below the list, a muted line counts them ("3 closed notes hidden.", with a tooltip saying what closed means) beside a Show button that runs the same command; when every note is closed, the line starts "Every note is closed." in place of the empty-dock message.
- Withdrawing a note or marking it addressed while closed notes are hidden takes it out of the list at once; the cursor stays at the same place in the list.

## Consequences

The dock can be kept to the notes still in play, and the line under the list means a hidden note is never forgotten. Addressed and withdrawn notes hide together; one cannot be listed without the other. The preference is global, not per session.
