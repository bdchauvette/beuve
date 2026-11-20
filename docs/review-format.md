# The review format (`beuve.ura/1`)

What beuve hands a coding agent when the reviewer copies their staged notes out: **Copy as XML** in the notes list (beside Post review on a pull request) or File › Export Review › Copy as XML, or **Copy as JSON** in either place for the same data as JSON. It is data only. It carries no instructions, so whatever reads it decides what to do with it. Paste it into a Claude Code session, or point a project's `CLAUDE.md` at this file and say that pasted `<beuve-review>` blocks are the reviewer's feedback on the current change.

The code is `src/internal/ura/build-agent-review.ts` (the structure) and `render-agent-review-xml.ts` (the XML). ADR 0023 and ADR 0131 give the reasons.

## Reading it

- Only **staged** notes are in it. Withdrawn and addressed notes are left out.
- Items are in the reviewer's order. Nothing in the order is a priority; use `severity` and `blocking`.
- Line numbers are 1-based and inclusive, and they count lines of the file **as it is at `head-sha`**, not of the base and not of any working tree.
- A note's `blocking` flag is the reviewer saying the author must resolve it before the change merges. `severity` says what kind of note it is, not how important it is.
- An agent should apply a `suggested-patch` only after checking it still applies where the note says it does (see `outdated`).

## The document

```
<beuve-review schema="beuve.ura/1" verdict="…" verdict-source="derived|chosen">
  <change scope="full|interdiff" base-sha="…" head-sha="…" [from-head-sha="…"]>
    <repository kind="…" …/>
  </change>
  [<summary>…</summary>]
  <counts issue="…" … blocking="…"/>
  <items> <item …>…</item> … </items>
</beuve-review>
```

The JSON form has the same data under camelCase keys (`baseSha`, `startLine`, `verdictSource`, `suggestedPatch`, `summary`), with optional keys left out rather than `null`. It is exact for text the XML has to normalize (see "Encoding").

### `beuve-review`

- `schema`: always `beuve.ura/1` for this format.
- `verdict`: what the reviewer asks of the author, as a GitHub review event would say it: `approve`, `comment` or `request-changes`.
- `verdict-source`: `derived` when beuve worked it out from the notes, `chosen` when the reviewer picked it. Derived means: any blocking note requests changes; otherwise an `issue`, `suggestion`, `question`, `todo` or `chore` leaves a comment, because the author has to act or answer; anything else approves.

### `change`

- `scope`: `full` covers the whole change. `interdiff` covers only what changed since an earlier head the reviewer had already seen, named by `from-head-sha`.
- `base-sha`: the fork point the review was diffed against. `head-sha`: the commit the notes are placed on.
- `repository` says where the change lives. Its `kind` is `local`, `github-pull-request` or `remote-branch` (a branch followed without a pull request). Every kind has `path` (the local checkout beuve used) and `base-ref`; the rest depends on the kind.
  - `local`: also `head-ref`.
  - `github-pull-request`: also `owner`, `repo` and `number`.
  - `remote-branch`: also `host`, `owner`, `repo` and `branch`.

### `summary`

The reviewer's own words on the review as a whole: the summary they typed in the notes list to post with it, which is also the top of the GitHub review body. Markdown, in a CDATA section, with surrounding whitespace trimmed. Absent when they wrote none. It comes after `change` and before `counts`.

### `counts`

One attribute for each label, always present, in label order: `issue`, `suggestion`, `question`, `nitpick`, `thought`, `smell`, `praise`, `note`, `todo`, `chore`. Then `blocking`, how many of the items are blocking. A blocking item is counted under its label as well.

### `items` and `item`

`items` holds the notes, one `item` each; it is empty when nothing is staged.

Attributes:

- `id`: the note's id.
- `severity`: the label, one of the ten above. They follow [Conventional Comments](https://conventionalcomments.org/), plus `smell` (nothing is wrong, but it feels off). `issue`: something is wrong. `suggestion`: a proposed improvement. `question`: needs an answer, not a change. `nitpick`: trivial and preference-based. `thought`: an idea that asks for nothing. `smell`: feels off. `praise`: something done well. `note`: something to be aware of. `todo`: a small, necessary change. `chore`: a task before the change is accepted.
- `blocking`: `true` or `false`.
- `origin`: `human` (the reviewer wrote it) or `chat-answer` (it came from a chat answer the reviewer staged). A `chat-answer` item also has `message-id`, and `finding` (the 0-based finding of a `/review` answer) or `proposal` (the 0-based note an answer proposed). A `finding` item may also have `confidence`: the model's own estimate, from `0` to `1`, that a careful reviewer would agree the finding is a real problem (ADR 0143). It is absent on findings staged before beuve kept it. It describes the finding as the agent raised it, even if the reviewer has since edited the note.

Children, in this order:

- `anchor`: where the note applies on `head-sha`. Absent when the note is outdated. Its `kind` is `lines` (with `path`, `start-line` and `end-line`), `file` (with `path` only: the note is about the whole file) or `change` (nothing else: the note is about the change as a whole).
- `outdated`: present instead of `anchor` when the note no longer maps onto `head-sha`. `reason` is `lines-changed` (lines it covers were edited or had lines inserted inside them), `file-deleted`, or `no-line-mapping` (beuve could not compare the two heads). `written-against-sha` is the head the reviewer wrote it on. Its child `original-anchor` has the same shape as `anchor`, but its lines belong to `written-against-sha`, not to `head-sha`.
- `title`: one line of inline Markdown. Absent when the reviewer gave none.
- `body`: Markdown, in a CDATA section. Always present; empty is `<body/>`.
- `suggested-patch`: present only when the reviewer attached a patch. its `format` is always `unified-diff`, and the patch is in a CDATA section, for the anchored path only. For a current item it applies to `head-sha`. For an outdated item it refers to `written-against-sha`.

## Versioning

`schema` names the format, and it changes only when a reader written for the old one could misread the new one: an element or attribute removed or renamed, a value given a new meaning, or a new value in a closed list (a label, an anchor `kind`, an outdated `reason`). Then it becomes `beuve.ura/2`, and this document describes the new format. Adding an optional attribute or child that a reader can ignore keeps `beuve.ura/1` (as `confidence` and `summary` did, ADR 0143), so a reader should ignore what it doesn't know.

## Encoding

- Titles are XML-escaped text. The summary, bodies and patches are CDATA; a `]]>` inside one is split across two CDATA sections, so reading the text back joins them again.
- Characters XML 1.0 cannot carry, even escaped (most control characters, lone surrogates), become U+FFFD.
- XML parsers normalize carriage returns, so a patch for a file with CRLF line endings is exact only in the JSON form.
