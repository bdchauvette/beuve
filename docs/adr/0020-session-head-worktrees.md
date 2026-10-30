# 0020. Session head checkouts in beuve-owned worktrees

- Status: Accepted
- Date: 2026-10-28

## Context

Language servers read files from disk, so LSP diagnostics and the call-stack peek portal need the session head checked out somewhere. The user's own working tree is usually on another branch, may be dirty, and is theirs: beuve must never switch, reset or write into it. ADR 0010 already gives the git domain a worktree manager (`addWorktree`, `removeWorktree`, `pruneWorktrees`, `planWorktreePath`), but nothing decides when checkouts are made, which ones live, or when they go away.

## Decision

- `src/main/worktrees/create-session-worktrees.ts` keeps detached worktrees under `<userData>/worktrees/`, at the git domain's planned path `<root>/<repo-name>-<hash of repo path>/<commit>`. The directory is keyed by commit, not by session, so sessions at the same head share one checkout and a path always holds the commit its name says.
- **Created on first need**: an LSP request (diagnostics, call hierarchy) refreshes the session from git and calls `ensure(repository, sessionId, head)`. Concurrent requests for the same checkout share one `git worktree add`. ImpactGate never needs a checkout; it reads blobs (ADR 0021).
- **Head moves**: the next request checks the new head out in a new directory and removes the session's previous checkout with `git worktree remove --force`, unless another session still uses it. Language servers started in the old directory are left to the multiplexer's idle timeout (ADR 0017).
- **Startup prune**: when the app starts, in the background, main runs `git worktree prune` in every repository with a stored session, removes that repository's worktrees under the root except those at a stored session head, and deletes any other directory under the root (checkouts of repositories that are gone, or interrupted adds). `ensure` waits for the prune to finish.
- A checkout whose directory was deleted behind git's back is pruned and checked out again by `addWorktree`. Hooks never run (ADR 0010's `core.hooksPath`).

## Consequences

Agents and the peek portal see exactly the reviewed commit, and the user's checkout is never touched. Each new head costs one checkout (no `node_modules`, so tsserver uses beuve's TypeScript and project typings that live in `node_modules` are missing), and the disk use is one tree per live head. A head change restarts the language server's project load in the new directory instead of updating files in place, which is slower but cannot leave a server with stale files. Worktrees of a repository with no remaining session are deleted from disk but stay registered in that repository until its own `git worktree prune` (git's gc runs it).

## Amendment (2026-10-30, ADR 0079)

`ensure` became `acquire`, which returns a lease released with `using`, and checks a `session-head` claim against the session's stored head. A checkout is removed when no lease holds it and it is no session's current checkout (or a sheet's pinned one), in the background rather than by the request that moved the head; adds and removals of one path are serialised, so a lease never gets a checkout that is being removed. Worktree add, remove and prune are `atomic`: an abort lets them finish.

## Amendment (2026-10-30, ADR 0081)

The manager remembers the checkouts it made and the ones the startup prune kept. A lease on one of them whose directory is still there is granted without asking git; any other state (an unknown path, a failed add or removal, a directory deleted behind beuve's back) goes through `addWorktree`, which asks git and repairs.
