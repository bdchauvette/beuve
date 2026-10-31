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

## Amendment 2026-10-30: stacks and commit pairs

ADR 0054 replaces the merge-base with a stack-aware fork point (a parent already on the base, or a reviewed base still under the head) for full reviews, interdiffs and checkpoints, and, when the range replay conflicts, retries by replaying the paired reviewed commits one by one before falling back.

## Amendment 2026-10-30: the CLI over a git library, revisited

Using the Claude Agent SDK rather than driving `claude` ourselves (ADR 0069) raised the question again for git. The cases differ: the SDK is the supported embedding of the same program, while libgit2 (nodegit, es-git), isomorphic-git and wasm builds are reimplementations of git. The decision stands, for these reasons:

- **Fidelity.** A review tool must show what `git diff` shows. The CLI is the user's own git: their config and `includeIf`, `.gitattributes`, LFS, partial clones, sparse checkouts and the exact rename and merge heuristics. A library that differs in a corner is a correctness bug in the review.
- **Coverage.** beuve relies on `merge-tree --write-tree --merge-base` (this ADR), `patch-id` (ADR 0054) and full worktree management (ADR 0020). libgit2 has no `patch-id`, no `merge-tree --write-tree` and partial worktree support. isomorphic-git has none of them and is slow on large repositories.
- **Transport and credentials.** `fetch` through the CLI uses the user's SSH agent, `~/.ssh/config`, credential helpers and `gh` integration. A library brings its own transport and authentication, which is a common source of failures.
- **Cancellation.** Killing a process is clean, and git removes its lock files and temporary files on `SIGTERM`. A libgit2 call runs on a native thread and can only be interrupted where it offers a progress callback, and many operations offer none. The interruption policies of ADR 0079 depend on the process boundary.
- **Isolation.** A crash, hang or memory blow-up in git stays in a child process with a timeout and an output cap. A native addon shares the main process.
- **Packaging.** No native addon to rebuild for each Electron ABI and architecture (ADR 0004).

We accept the costs:

- A process spawn per operation, which costs more on macOS than on Linux.
- Parsing text output, which stays contained in the typed operations of `src/internal/git`. Callers never see raw output.
- A minimum system git of 2.36.

If spawning shows up as a real cost, the remedy is to batch requests through long-lived git processes, such as `cat-file --batch-command` for object reads, not to switch to a library. Revisit this decision only if a library gains `merge-tree`, `patch-id` and worktree parity and becomes the reference implementation, or if beuve has to run where no system git exists.

## Amendment 2026-10-31 (ADR 0087)

The remedy named above is in place: single-object reads and ref lookups go through one long-lived `git cat-file --batch-command --buffer` per repository root (`GitObjectReader`), with structural, validated specs and restart rules. Diffs, `merge-tree`, `rev-list`, `ls-tree -r`, `git grep`, `check-attr`, fetches and the worktree commands still spawn one process each.
