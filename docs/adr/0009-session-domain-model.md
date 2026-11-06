# 0009. Session domain model and schema

- Status: Accepted; checkpoints amended by [0012](0012-checkpoint-base-and-review-composition.md)
- Date: 2026-10-28

## Context

ADR 0006 gives `src/internal/session/` the `sessions` and `checkpoints` tables. The spec's `sessions` row (id, repo_path, pr_number, last_checkpoint_sha, current_sha, updated_at) can't tell a local agent branch from a GitHub PR except by a nullable `pr_number`, can't say what a full review diffs against, and stores `last_checkpoint_sha` separately from the checkpoint rows it summarizes, so the two can disagree.

## Decision

- **Domain types** (`session.ts`): branded `SessionId`, `CheckpointId` and `CommitSha` (`Brand<string, 'CommitSha'>`, structurally identical to the git domain's, so main can pass one for the other without either domain importing the other). Commit ids are full 40- or 64-hex, lowercased by `parseCommitSha`.
- `SessionSource` is a union: `local` (repoPath, baseRef, headRef) or `github-pull-request` (repoPath, baseRef, owner, repo, number). Both carry `baseRef` because a full review needs a base; no auth or remote data lives here.
- `ReviewState` is `unreviewed | reviewed(checkpoint)`, derived from the latest checkpoint. `computeReviewRange` returns `full(baseRef, headSha) | interdiff(fromReviewedSha, toHeadSha) | up-to-date(headSha)`; the git domain turns it into a diff (and decides how to handle a rebased head).
- Transformations are pure, with clock and id generator injected (`SessionDeps`, defaulting to `systemSessionDeps`). Repositories take a `DatabaseSync`, validate every row on the way out and return `corrupt-row` errors instead of casting.
- **Schema departures from the spec**:
  - No `last_checkpoint_sha`: queries join the latest checkpoint (by `created_at`, then insertion order). One source of truth; the cost is a correlated subquery that the `(session_id, created_at)` index serves.
  - `current_sha` is `head_sha`; added `kind`, `base_ref`, `head_ref`, `owner`, `repo` and `created_at`.
  - A table-level CHECK mirrors the union: local rows have `head_ref` and no PR columns, PR rows the reverse with `pr_number > 0`. SHAs and `toISOString()` timestamps are format-checked; tables are STRICT.
  - Partial unique indexes allow one session per change (`repo_path, base_ref, head_ref` for local; `repo_path, owner, repo, pr_number` for PRs), so `insertSession` reports `duplicate-session` and callers resume via `findSessionBySource`.
  - `checkpoints.session_id` cascades on delete.

## Consequences

The persisted review state can't drift from checkpoint history, and illegal source shapes are rejected by both the types and SQL. Checkpoint order depends on the injected clock, with insertion order breaking ties. Main composes `sessionMigrations` from `#internal/session/session-migrations.ts` before any domain whose tables reference `sessions`.

## Amendment 2026-11-06: remote branches

A third kind, `remote-branch` (forge, host, owner, repo, branch), with its own partial unique index, and `promoteSession` turning one into a `github-pull-request` row in place ([0112](0112-remote-branch-sessions.md)).
