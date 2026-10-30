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

## Consequences

A signal can now be forwarded to any git operation without asking whether it is safe to kill: the operation decides. A cancelled worktree add costs the rest of its checkout instead of a broken directory. Adding a git operation means choosing its policy, and adding a raw command outside the git domain fails `npm run deps`. A hung atomic command can only be stopped by its timeout.
