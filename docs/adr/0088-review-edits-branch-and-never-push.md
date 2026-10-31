# 0088. Review edits: one writable local branch per session, harvested as suggestions; beuve never pushes

- Status: Accepted
- Date: 2026-10-31

## Context

Reviewers sometimes want to try a change in a real editor, with the project's tooling, rather than in the diff (ADR 0043's `e`). Until ADR 0033's amendment they did it, often by accident, in beuve's per-commit checkout, which the language servers, chat and trace probes read as the reviewed SHA, and which a head move deleted with `--force`. Those checkouts are now read-only. The spec calls beuve "review-first, authoring-resistant": it must not become the place where code is written and shipped, and it must never change the reviewer's own checkout or publish anything. Task #28 asked for a sanctioned place to edit whose edits flow back as review comments.

## Decision

### The authoring-resistant boundary, restated

- **beuve writes only to the review-edits worktree**, a checkout of a branch it made for the purpose, and only through `git worktree add` and `git worktree remove`. It never writes to the reviewer's own checkout or index, never to its own read-only checkouts (ADR 0033 amendment), and never commits on the reviewer's behalf.
- **Edits flow back as review suggestions** (ADR 0043, 0023), which the reviewer previews and confirms. Applying a suggestion to any tree stays out of scope.
- **beuve never pushes.** Review-edits branches are local only.

### The branch and its worktree

- **Open Review Edits** (Review ▸ Review Edits ▸ Open in Editor, `open-review-edits`) makes, on first use, a real local branch `<prefix><pr-N>` for a pull request session or `<prefix>session-<first 8 of the id>` for a local one, starting at the session's reviewed head, and opens the focused file (or the first file of the review) there in the editor (ADR 0033, Zed first). The prefix is `review/` and is set in Settings (`reviewEditsPrefix` in `settings.json`, beside `preferredEditor`).
- **Name and collisions.** The name is checked with `git check-ref-format --branch` (after refusing a leading `-`, `@{` and control characters). `review_edit_branches` records, per session, the branch, its repository and the base it started at; `(repo_path, branch)` is unique. A branch of that name that already exists in git without this session's record is refused with a message naming it ("Rename it, or change the review-edits prefix"); one this session recorded is reused, whatever it holds.
- **Worktree.** `addBranchWorktree` (git domain, `atomic`) checks the branch out at `<userData>/review-edits/<repo>-<hash>/<branch slug>-<hash of branch>`, a root separate from the read-only checkouts' `<userData>/worktrees`, so no prune of those ever reaches it; the directories are 0700 (ADR 0082). New branches are created with `--no-track`, and nothing configures a remote or upstream for them. Hooks don't run.
- **Leases.** The worktree manager gains the third claim kind ADR 0079 anticipated, `review-edits { sessionId, branch, base }`, with its own planned path and add operation and the same lease counts, holders and per-path serialisation. Its holder (`edits\0<session>`) is never released by a head move or a lease's end, so the worktree is never collected; it is not made read-only.
- **Lifecycle.** Nothing deletes the branch or the worktree automatically: not a head move, not the startup prune, not closing or archiving the session. **Discard Review Edits…** shows what would be lost (files that differ from the base, committed or not, and commits beyond it) and, on confirmation, removes the worktree with `--force` and deletes the branch with `update-ref -d <ref> <tip>`, so a commit made after the confirmation is never lost; a digest of the state shown is checked again first. A deleted worktree directory with its branch still there is fine: `git worktree prune` drops the record and the next Open checks the branch out again, its commits intact (uncommitted work in the deleted directory is gone, as the user deleted it).
- **Head moves.** The branch stays on the head it started from; the dock says "on an older head". Its suggestions are written against that head, and items on older heads are already re-anchored or marked outdated (ADR 0023, 0078). **Move edits onto the new head is deferred**: the edits are usually uncommitted, and carrying them over needs a three-way merge of the working tree (stash, which shares `refs/stash` with the reviewer's own checkout, or `merge-tree` plus a checkout of the result) with a clean abort on conflict; that is more than this change should take on. Discard and Open again starts over at the new head.

### Turning edits into suggestions

**Turn into Suggestions…** (`harvest-review-edits`) never commits and never touches the worktree's index:

1. **Snapshot.** `snapshotWorktree` runs `git add --all` and `git write-tree` with `GIT_INDEX_FILE` pointing at a temporary index in a fresh temporary directory, seeded from a copy of the worktree's index that keeps its modification time (so git's racy-entry check still sees an edit made in the same second as the checkout). The result is a tree with every committed, staged, unstaged and untracked (not ignored) change. The runner gained an `indexFile` option for this; it is the only environment variable an operation can set.
2. **Diff** that tree against the reviewed head with no context lines, and diff the pull request (fork point to the reviewed head) for the lines it added.
3. **Plan** (`planEditSuggestions`, pure): each change region of a modified text file whose head lines are all lines the pull request changed becomes a suggested patch over those lines (ADR 0043's shape: remove every anchored line, add the replacement, three context lines), validated with `parseSuggestedPatch`. It attaches to a staged line note at that head that covers it and has no patch of its own (or only one an earlier harvest gave it); several regions inside one note become one patch over the note's lines. Otherwise it is a new line note. A pure insertion becomes a replacement of the line above (of line 1 at the top), as GitHub suggestions express it. Everything else, edits to lines the pull request didn't change, new files (whole-change notes), deleted, renamed, copied, binary and mode-only files (file notes), and regions next to a missing final newline, becomes a note whose body carries a ` ```diff ` block.
4. **Preview, then stage.** The dock lists each edit with its action (new, attach, update, staged), anchor and diff, and a digest of the plan. Stage recomputes the plan and refuses if the digest differs ("preview them again"), so only what was shown is staged, through `ura.create` and `ura.update` with the edits' base as the item head.
5. **Idempotent.** `review_edit_suggestions` records, per session, head and target (path and head lines, a file, or a new path), the item an edit became and a fingerprint of its content. The same edit again is `unchanged`; a changed one updates its item (the patch only, for a note the reviewer wrote); a deleted item drops its record (cascade).

### Never push, enforced

- The git domain has no push operation, and `execGit` and `streamGit` refuse any subcommand that isn't on `isAllowedGitCommand`'s list (only `-c name=value` may precede it). The list has no `push`, `send-pack`, `http-push`, `remote` or `credential`; its test fails if one appears, and another test fails if any git-domain source names `push`.
- `local/no-git-push` reports, outside tests, any string that is exactly a publishing subcommand or that names `refs/heads/review/…`.
- `fetchRefs` already writes only under `refs/beuve/`, so a fetch can't touch `refs/heads/review/*`.
- Lifting any of this needs an ADR that supersedes this one.

### UI

The dock shows the review edits quietly, under the staged items, only once they exist: the branch (through `pathText`), files changed and commits, "on an older head" when it applies, and Open, Turn into Suggestions… and Discard…; then the confirmation steps. Its buttons are delegated (`data-action="review-edits"`, ADR 0074). The three commands sit in Review ▸ Review Edits with no default keys (ADR 0068). The window counts the edits again when it regains focus, since they are made in the editor.

## Consequences

Reviewers can edit with their own tools without endangering what beuve reviews, and what they edit comes back as ordinary review items that every exporter already understands. The edits branch is a real branch in the reviewer's repository: they can commit to it, diff it or push it themselves; beuve only refuses to. Harvesting walks the worktree once per preview and stage (an `add --all` on a seeded index), and reads the pull request's diff at the base. Moving edits to a new head is manual for now.
