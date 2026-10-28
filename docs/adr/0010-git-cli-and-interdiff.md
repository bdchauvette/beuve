# 0010. Git through the CLI, and rebase-aware interdiffs via merge-tree

- Status: Accepted
- Date: 2026-10-28

## Context

The `git` domain resolves revisions, diffs pull-request ranges, manages review worktrees and computes interdiffs (spec 5F). It needs worktrees, rename detection, merge-base semantics and three-way merges, and it reads repositories we didn't create, so it is a security boundary. The options were isomorphic-git (pure JS: no worktrees, no `merge-tree`, weak rename detection, slow on large repositories), nodegit (a libgit2 native addon that must be rebuilt per Electron ABI, the problem ADR 0004 avoided, and lags git features) or the git CLI the user already has.

## Decision

- Shell out to `git` with `execFile` (never a shell) through one runner, `run-git.ts`, which adds a timeout, an output cap, `-c core.quotepath=off`, literal pathspecs, no pager, colour or diff-prefix surprises, disables `core.fsmonitor` and hooks, drops inherited `GIT_*` variables, sets `GIT_TERMINAL_PROMPT=0`, `GIT_NO_REPLACE_OBJECTS=1` and `LC_ALL=C`, and maps failures to a `GitError` union. Diffs pass `--no-ext-diff --no-textconv`. Untrusted revisions are validated and passed after `--end-of-options`; every other operation takes a `CommitSha` resolved by git. Minimum git: 2.36 (`worktree list -z`).
- Parse unified diffs ourselves (pure, count-driven), keeping each file's raw patch text for `@pierre/diffs`.
- Interdiff from reviewed `{base, head}` to new `{base, head}`, with both fork points taken as merge-bases:
  - Fork point unchanged: `diff oldHead newHead` (`exact`).
  - Fork point moved: `git merge-tree --write-tree --merge-base=<oldFork> <newFork> <oldHead>` replays the reviewed changes onto the new fork point as a tree, without touching refs or worktrees; the interdiff is that tree against `newHead` (`rebased`). Upstream changes are on both sides and cancel out.
  - The replay conflicts, or git is older than 2.38: return `fallback` with the full new range and the reason. Git 2.38–2.39 (e.g. Apple's) has no `--merge-base`, so it is used only when git's own merge-base already equals the old fork point.

## Consequences

beuve requires a system git and pays a process spawn per operation, but gets git's own semantics, worktrees and merge machinery with no native dependency. Interdiff limits: lines changed when the author resolved a rebase conflict can't be separated from upstream, so conflicts fall back to a full review; in the clean case, anything that differs from the mechanical replay (including edits the author needed to adapt to upstream) shows as an author change, which is intended; the replay uses git's default merge and rename heuristics; content is decoded as UTF-8, so other encodings display lossily. Repositories owned by another user surface as `unsafe-repository` rather than being trusted silently.
