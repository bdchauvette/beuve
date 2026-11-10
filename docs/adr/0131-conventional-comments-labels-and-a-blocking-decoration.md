# 0131. Conventional Comments labels for review notes, and a blocking decoration

- Status: Accepted
- Date: 2026-11-10

## Context

A review note (a URA item, ADR 0023) had one of five severities: blocker, issue, question, nit and praise, each with an emoji (ADR 0100). The list mixed two questions, what kind of note this is and whether it stops the merge, so a blocking question or a blocking typo could not be said, and a thought, a smell or a note to be aware of had to be passed off as a nit or a question. [Conventional Comments](https://conventionalcomments.org/) answers both questions separately and is widely read on GitHub: a label (`praise`, `nitpick`, `suggestion`, `issue`, `todo`, `question`, `thought`, `chore`, `note`, `typo`, `polish`, `quibble`) and decorations such as `(blocking)`, written `**issue (blocking):** subject`.

## Decision

- A note's label is one of the Conventional Comments labels or beuve's own `smell` (nothing is actually wrong, but it feels off). It is still stored, carried over IPC and sent to agents as `severity`, so the column, the contract and the payload keys stay where they were; only the values change.
- Whether a note blocks is a separate boolean, `blocking`, on any label: `ura_items.blocking` (`0`/`1`), `UraItem.blocking`, `UraItemView.blocking`, `blocking?` on `ura:create` (default `false`) and `ura:update`. It is the only decoration: `non-blocking` and `if-minor` could be added later as more flags, but nothing needs them yet, and an unmarked note already reads as non-blocking.
- Each label has an emoji, superseding ADR 0100's list: ⚠️ issue, 💡 suggestion, ❓ question, ⛏️ nitpick, 💭 thought, 👃 smell, ✨ praise, ℹ️ note, ☑️ todo, 🧹 chore, 🔤 typo, 💅 polish, 🤏 quibble. A blocking note shows 🛑 before its label's emoji and `(blocking)` after its label in the dock row, the diff marker, the sheet's note, and the command palette's detail.
- The composer and the dock editor offer every label, the ones reviewers reach for most first, in the order the domain's list keeps for counts and payloads too: issue, suggestion, question, nitpick, thought, smell, praise, note, todo, chore, typo, polish, quibble. Beside the select is a Blocking toggle, a `.button[aria-pressed]` toggle (ADR 0115) rather than a checkbox, because both forms read their title as their first `input`. A new note is an `issue`, not blocking.
- The posted GitHub review writes the label the Conventional Comments way, lowercase with its decoration: `⚠️ **issue (blocking):** title`, `✨ **praise**` without a title, and `#### 💡 suggestion: title` for a section of the body.
- The agent payload (`beuve.ura/1`, JSON and XML) gives every item `blocking` (`blocking="true"` or `"false"` in XML), and `counts` has every label plus `blocking`, the number of blocking items. The schema name stays `/1`: nothing has been released, as with the migrations.
- The verdict: any staged blocking note requests changes, and approving over one is refused (the error kind is `approve-over-blocking`; a dropped approval is cleared as `blocking-staged`). Otherwise an `issue`, `suggestion`, `question`, `todo`, `chore` or `typo` leaves a comment, since the author has to act or answer; `nitpick`, `quibble`, `polish`, `thought`, `smell`, `note` and `praise` approve, because they are optional or ask for nothing. The old values map onto this unchanged: `blocker` is `issue` with `blocking`, `nit` is `nitpick`.
- A `/review` finding (ADR 0055) is still never blocking: `risk` and `warning` stage as `issue`, `info` as `nitpick`.

## Consequences

- `nit` is stored as `nitpick` rather than kept and displayed as "nitpick": the label then reads the same in the database, the agent payload and GitHub, and no table maps stored values to shown ones. Migrations are still squashed (ADR 0006 amendment: no tag yet, version 0.1.0), so `ura-0001-initial` was edited in place: the `severity` CHECK lists the new labels, `blocking` is a new column, and `cleared_reason` allows `blocking-staged`. Nothing reads `blocker` or `nit` any more; a row holding either is a `corrupt-row`.
- The emoji still live in two tables (`src/internal/ura/ura-severity-emoji.ts`, `src/ui/ura-severity-emoji.ts`, ADR 0100), plus `src/ui/ura-blocking-emoji.ts` for 🛑, which the domain does not need since GitHub carries `(blocking)` in words.
- The code keeps the name `severity` for the label (`UraSeverity`, `UraSeverityView`, `uraSeverities`), now a misnomer; renaming it is mechanical and can come separately.
- The diff marker and the dock row now say `patch`, not `suggestion`, for a note carrying a suggested patch, so a `suggestion` note with one does not say it twice.
