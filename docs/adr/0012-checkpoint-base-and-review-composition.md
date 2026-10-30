# 0012. Checkpoints record the reviewed base; main composes session and git

- Status: Accepted
- Date: 2026-10-28

## Context

ADR 0010's interdiff needs the previously reviewed `{base, head}` to tell author changes from a rebase, but ADR 0009's checkpoint stored only the reviewed head. Without the old fork point, a rebased branch can only be diffed head to head, which drags every upstream commit into the "what changed" view. The session and git domains also have to meet somewhere to turn a review range into a diff, and ADR 0002 forbids them from importing each other.

## Decision

- A checkpoint is `{ baseSha, headSha }`: the head the reviewer signed off on and the fork point it was diffed against (the merge-base of the base branch and that head, as git reported it when the reviewer marked it). `recordCheckpoint` takes a `ReviewedRange`.
- Migration `session-0002-checkpoint-base` rebuilds `checkpoints` with `base_sha` and `head_sha`, both `NOT NULL` and format-checked, instead of adding a nullable column. No build ever wrote a checkpoint (sessions weren't wired until now), so there is no data to preserve; any stray row is dropped and its session simply reads as unreviewed, i.e. a full review. This keeps `baseSha` non-optional in the types, with no legacy branch to carry.
- `computeReviewRange` returns `interdiff { baseRef, fromBaseSha, fromHeadSha, toHeadSha }`. The session domain doesn't know commits' ancestry, so the target base stays a ref; main resolves it.
- `src/main/sessions/` is where the domains meet. Each operation refreshes the session from git (resolve the base ref, and for local sessions the head ref, persisting a moved head), asks the session domain for the range, and asks the git domain for the diff: `diffRange` for `full`, `computeInterdiff({fromBase, fromHead}, {baseTip, head})` for `interdiff`. Commit ids pass between domains unconverted, because both brand them as `Brand<string, 'CommitSha'>` (ADR 0009). Results are mapped to plain contract DTOs (`ReviewView`, `DiffFileView`), and `GitError`/`SessionError` to `IpcError` codes with short messages; raw git output only goes to main's log.
- `session:mark-reviewed` records the refreshed head and its current merge-base. The UI passes the head it showed as `expectedHeadSha`, and main answers `stale-review` if the head has moved, so a reviewer never signs off on commits they haven't seen.
- If the previously reviewed commits are gone (garbage-collected after a force-push), main shows the full change with fallback reason `reviewed-commits-missing` instead of failing.

## Consequences

Interdiffs survive rebases, and the session domain stays free of git. Every review request costs a few git spawns (version, top level, two `rev-parse`s, merge-bases, one diff), which is fine for local repositories. A checkpoint's base is a snapshot: if upstream history is rewritten under it, the next interdiff falls back rather than guessing. GitHub pull-request sessions keep their stored head until the GitHub integration refreshes it.

## Amendment 2026-10-29: migrations squashed

Squashed into `session-0001-initial` (ADR 0006); the schema described here is unchanged, and no upgrade step exists. The `session-0002-checkpoint-base` rebuild is gone, along with its dropping of stray rows.

## Amendment 2026-10-30: stacks and commit pairs

ADR 0054 replaces the merge-base with a stack-aware fork point (a parent already on the base, or a reviewed base still under the head) for full reviews, interdiffs and checkpoints, and, when the range replay conflicts, retries by replaying the paired reviewed commits one by one before falling back.
