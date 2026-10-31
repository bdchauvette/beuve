# 0081. Shared git caches keyed by commits; refs are never cached

- Status: Accepted; amends [0079](0079-git-interruption-policies-worktree-leases-and-supersession.md) and [0020](0020-session-head-worktrees.md)
- Date: 2026-10-30

## Context

A large review (18.7k files, 326 changed) spawned about 995 git processes, and Electron's main thread was blocked inside `execFile` for 5.8–7.6 s of it. Almost all of that work was repeated. Every request opened the repository again (`--version`, `rev-parse --show-toplevel`), recomputed the stack-aware fork point (`merge-base`, `rev-list`, `rev-parse ^{tree}`, `merge-tree`) and reran the whole-range `git diff` (about 1 MB). Only `session:get-review` and the order service had a diff cache, each its own; the language server, `getFilePair`, sheets, ImpactGate and chat had none, so one "order by calls" pass made 66 whole-range diffs. Each worktree lease ran `git worktree list`. The investigation for task #29 (and its what-if, which memoized every pure call) showed caching alone brings the review to about 350 spawns.

Two things make caching safe here. Since ADR 0078 and 0079 a request pins the commits it works on, so most results are functions of commit SHAs, which name immutable objects. And ADR 0079 binds each repository handle to its request's signal, so a shared computation must not run on any one request's handle.

## Decision

### What is cached

`SessionContext.caches` (`src/main/sessions/create-git-caches.ts`) holds three caches shared by every service of one main process; the worktree manager keeps a registry of its own.

| Cache                                                                                            | Key                                                                                                                                    | Bound                                                                                                       | Consumers                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rangeDiffs`: the review diff (`RangeDiff`: scope, fork point, files, commit pairs, attribution) | root, git version, base tip SHA, range kind, reviewed-from base and head SHAs, the checkpoint's base SHA, head SHA, whitespace variant | 32 entries and a weight of 256 MiB (four times the patch text, for the UTF-16 strings and the parsed lines) | everything that calls `loadReviewDiff`: the review, order, files (`getFilePair`, attributes), LSP, ImpactGate, chat, flow, trace, URA, `setFileReviewed` |
| `forkPoints`: `findStackForkPoint`                                                               | root, git version, base tip SHA, head SHA, the reviewed bases (sorted)                                                                 | 1024 entries                                                                                                | the range diff, `markReviewed`, sheets                                                                                                                   |
| `probes`: `openRepository`'s probe (`RepositoryProbe`: top level and git version)                | the directory path                                                                                                                     | 64 entries                                                                                                  | `refreshSession` (so every request), `createLocal`, the pull request poller                                                                              |
| worktree registry: checkouts the manager made or the startup prune kept                          | checkout path → commit                                                                                                                 | the checkouts on disk                                                                                       | `SessionWorktrees.acquire`                                                                                                                               |

Only successes are kept. A failure, an abort or a value heavier than the whole bound is returned and forgotten.

### Refs are never cached

Resolving a ref name to a SHA (`resolveRevision` on the base ref and the head ref) is done afresh by every request, as before. Refs move; SHAs don't. Every key above except the probe's and the registry's is built from SHAs the request already resolved (or pinned, ADR 0078 and 0079) plus fixed values, so a kept entry is never stale and needs no invalidation; only the bounds evict it. The git version is in the keys because the version decides what `merge-tree` can do (ADR 0010); repository configuration that steers merges and renames is read when an entry is first computed.

### Path-keyed entries, and why they are safe

- **Probes.** A directory's top level and the git that serves it change only if the repository is moved or deleted, or git is replaced, while beuve runs. When resolving the base ref fails with `not-a-repository`, `unsafe-repository` or `git-not-found`, `refreshSession` drops the directory's probe and the next request probes again. A git upgraded underneath keeps its old version in the key until then, which only means the older feature set.
- **The worktree registry.** A lease on a path the registry knows, at the same commit, whose `.git` file is still on disk, skips `addWorktree` and with it `git worktree list`. Anything else goes through `addWorktree`, which asks git and repairs: a path the registry doesn't know, a failed add (the entry is dropped before the add and set only after it succeeds), a removal (dropped before `worktree remove` runs, whatever its outcome), and a directory gone from disk (`addWorktree` lists, prunes the record and checks out again). The startup prune clears the registry and fills it with the checkouts it kept. The registry is changed only on a path's serial chain (ADR 0079) or by the prune, which every acquire waits for.

### Handles: probe once, bind per request

`OpenRepositoryOptions.probe` binds a new handle to a kept probe without running git. `openSessionRepository` gets the probe from the cache and returns a handle bound to `context.git` and the request's signal, so no request's signal reaches another's commands (ADR 0079). A shared computation runs on a handle of its own, made by `rebindRepository` and bound only to `context.git` and the computation's signal.

### Coalescing and cancellation

The caches are `CoalescingCache`s (`#x/async/coalescing-cache.ts`). Concurrent misses on one key share a single computation, which gets its own `AbortController`:

- a caller whose signal aborts stops waiting at once and gets `aborted` (`cancelled` over IPC);
- the computation is aborted only when the last waiting caller gives up, and an aborted computation is not kept; a caller without a signal (chat, MCP) always counts, as for ImpactGate's shared runs (ADR 0079);
- a superseded review whose diff nobody else waits for still has its `git diff` stopped, as ADR 0079 requires; two windows loading the same review share one diff, and closing one leaves the other's running.

`createMainServices({ caching: false })` swaps every cache for a pass-through that computes on the caller's own signal. `create-git-caches.test.ts` runs a review (full, up to date, then an interdiff after a rebase, with both whitespace variants, order, attributes, tree, file pairs and sheets) through both and expects every answer to be identical.

### Not cached

Sheets' one-file `--unified=0` diff, `getFilePair`'s and sheets' blob reads, `ls-tree <sha> -- <path>` and ref lookups still spawn per request. Task #30's `GitObjectReader` on `cat-file --batch-command` is meant to serve the reads and ref lookups; it can sit behind the same per-request handles, since the probe cache already gives one place per root to own a long-lived process.

## Consequences

The large review drops from 994 spawns to 283, and the main thread's time blocked in `execFile` from about 7.3 s to about 1.8 s (measurements in the task #29 report). What remains is mostly ref resolution (215 `rev-parse`s), which stays live by design, and per-request object reads. Results are the same with and without the caches, by test. Memory is bounded by the counts and the diff weight; a review whose diff alone is heavier than 256 MiB is recomputed per request, as before. A probe can be stale until the next failed ref lookup. Adding a cached result means building its key from SHAs; a cache keyed by a ref name or a path needs its own invalidation argument here.

## Amendment 2026-10-31 (ADR 0087)

`GitCaches` also owns the `ObjectReaderPool` (one `cat-file --batch-command` per root, disposed with the caches on quit) and `treeFiles`, the `listTreeBlobs` listing per root and commit that chat's sandbox reads. The "Not cached" reads above now go through the reader: ref lookups stay live, but no longer spawn.
