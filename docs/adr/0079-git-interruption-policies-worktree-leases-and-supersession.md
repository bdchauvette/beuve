# 0079. Git interruption policies, worktree leases, and superseded requests

- Status: Accepted
- Date: 2026-10-30

## Context

ADR 0075 let a signal reach git: an abort kills it with SIGTERM and the call fails with `aborted`. That is right for a read, but git also writes: a fetch updates `refs/beuve/`, a replay writes objects, and the worktree manager (ADR 0020) adds and removes checkouts. A `git worktree add` or `remove` stopped halfway leaves the worktree registered with files missing, and `addWorktree` then hands that directory out as a finished checkout. Only the pull request poller passed a signal, so this had not bitten yet, but every new caller that forwarded one would have risked it. Anything could also call `repository.run(args)` with raw arguments and skip whatever rule the typed operations followed; the editor did, for `git status`.

## Decision

### Every git command declares an interruption policy

- `InterruptionPolicy` (`src/internal/git/interruption-policy.ts`) is one of:
  - `read`: changes nothing. An abort sends SIGTERM; the call fails with `aborted`.
  - `owned-write`: writes only state beuve owns (objects, `refs/beuve/`), which git's own SIGTERM handler leaves consistent: it deletes its lock files and temporary packs before it exits. An abort sends SIGTERM, waits for git to exit, runs the operation's optional `cleanup`, and fails with `aborted`.
  - `atomic`: must not stop halfway. The abort does not reach git: it runs to completion (still bounded by its timeout), and the call then fails with `aborted` if the signal aborted meanwhile. An already aborted signal starts nothing, under every policy.
- **The runner requires it.** `GitRunOptions.policy` and `GitRequest.policy` are required fields, so an operation that runs git cannot compile without choosing.
- **`execGit` resolves only once git has exited.** `execFile` answers an abort as soon as it has sent the signal, while git may still be deleting its locks; waiting for `exit` makes "aborted" mean "stopped and cleaned up".
- **SIGTERM only.** An abort and a timeout both send SIGTERM (`killSignal` is explicit). Nothing escalates to SIGKILL, so git always runs its lock cleanup, and beuve never deletes `.lock` files itself: a lock it found could belong to a git process the user started.
- **Each operation's policy:**

  | Policy        | Operations                                                                                                                                                                                                                                                                                                                                                                                      |
  | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `read`        | `resolveRevision`, `findMergeBase`, `diffObjects` (and `diffRange`), `findStackForkPoint`, `listRangeCommits` (log and `patch-id`), `readBlobs`, `findTreeBlob`, `listTreeBlobs`, `listTreePaths`, `readDiffAttributes`, `listRemoteUrls`, `inspectBranches`, `listWorktrees`, `readPathStatus`, the `--version` and `--show-toplevel` probes of `openRepository`, `replayCommits`' tree lookup |
  | `owned-write` | `fetchRefs` (objects and `refs/beuve/` only; refs a stopped fetch did move are caches its callers verify before use), `replayChanges` (`merge-tree --write-tree`) and `replayCommits`' `commit-tree` (unreferenced objects, which gc drops)                                                                                                                                                     |
  | `atomic`      | `addWorktree`, `removeWorktree`, `pruneWorktrees`                                                                                                                                                                                                                                                                                                                                               |

- **Worktrees are `atomic`, not `owned-write` with cleanup.** `git worktree add` checks out in a child process, which a SIGTERM to the parent does not reach, so git's own "remove junk" handler can race the child still writing into the directory, and a cleanup of ours would race it too. Letting the checkout finish is bounded and leaves a state that is right either way. Add and remove get a 10-minute timeout instead of the default 30 seconds, since an atomic command can only be stopped by its timeout. For the timeout or a crash, `addWorktree` deletes an unregistered directory at its planned path before adding, and after a failed add removes what it left (directory, then `worktree prune`).
- **Raw git stays in the git domain.** `GitRepository` no longer has `run` and `exec`. Its runner sits under the `gitRunner` symbol (`src/internal/git/git-runner.ts`), and the dependency-cruiser rule `git-only-through-typed-operations` lets only `src/internal/git/` import `git-runner.ts`, `exec-git.ts` or `run-git.ts`. Code elsewhere can hold and pass a `GitRepository` but cannot run a command on it except through a typed operation. The editor's `git status` became `readPathStatus`.

### Worktrees are leased

The worktree manager (ADR 0020) handed a path out with no record of who used it, and removed a session's previous checkout as soon as the session asked for a new one. A stale `ensure` from a job that read the head before it moved re-created the old checkout and deleted the current one, and a second session at the same head could be handed a checkout whose removal had already started (both reproduced by the TOCTOU audit, and now tests).

- **`acquire(repository, claim, { signal })` returns a `WorktreeLease`** (`{ path, commit }` and `Symbol.dispose`), released with `using`. Disposing twice releases once. Every user takes one for as long as it works in the directory: a language-server request, a chat request (the read-only sandbox runs inside it), a trace probe, and the editor until it has started.
- **A claim says what the checkout is for.** `session-head` must name the session's stored head (read from the database through `storedHead`), both when asked and again when the checkout is ready; otherwise the answer is a typed `stale-head` refusal and nothing is created, assigned or removed. A granted `session-head` becomes the session's checkout, replacing its previous one. `pinned-commit` (a sheet pinned to an older commit, ADR 0067) may name any commit and keeps its checkout until the next startup prune.
- **A checkout is removed only when no lease holds it and it is no session's current checkout or a pinned one.** Leases are counted per path, and the count goes up before anything is awaited, so a removal deciding whether to run sees every lease asked for so far.
- **Adds and removals of one path run one at a time**, on a per-path promise chain. A lease asked for while its path is being removed waits for the removal and checks the commit out again; it can never be handed a directory that is going away.
- **The manager runs git on its own handles**, opened from `SessionWorktreesOptions.git`, never on a caller's (which may be bound to that caller's signal). The caller's signal bounds only its wait: an aborted acquire returns `aborted` at once, and the checkout, being `atomic`, finishes and stays the session's if the head is still its own.
- **Callers stop first.** Chat's `prepare` and the trace job check for an abort before acquiring, and release the lease when they find one after.
- `settled()` waits for queued adds and removals; main's `dispose` awaits it.
- **Task #28's writable review-edits worktree** is meant to be a third claim kind with its own planned path and add operation (a branch, not a detached head), keeping the same leases, holders and per-path serialisation.

## Consequences

A signal can now be forwarded to any git operation without asking whether it is safe to kill: the operation decides. A cancelled worktree add costs the rest of its checkout instead of a broken directory. Adding a git operation means choosing its policy, and adding a raw command outside the git domain fails `npm run deps`. A hung atomic command can only be stopped by its timeout.

A checkout is now removed in the background when its last lease goes, not by the request that moved the head, so that request no longer waits for a large directory to be deleted. A language server started in a removed checkout is still left to the multiplexer's idle timeout (ADR 0020); it holds no lease between requests. A request that asked for a head that had just moved is refused instead of answered from the old commit; the poller's head move already aborts the chat, trace and ImpactGate work behind it.
