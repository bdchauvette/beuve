# 0087. One long-lived `git cat-file --batch-command` per repository, and a chat sandbox read from git objects

- Status: Accepted; amends [0010](0010-git-cli-and-interdiff.md), [0070](0070-model-port-capabilities-and-a-model-registry.md), [0071](0071-openai-compatible-adapter.md), [0079](0079-git-interruption-policies-worktree-leases-and-supersession.md), [0081](0081-shared-git-caches-keyed-by-commits.md) and [0082](0082-atomic-writes-owner-only-user-data-and-visible-path-controls.md)
- Date: 2026-10-31

## Context

After the shared caches of ADR 0081, a large review still spawned about 280 git processes, most of them ref lookups (`rev-parse`, which stays live by design) and single-object reads: `getFilePair`'s and sheets' `cat-file` pairs, `ls-tree <sha> -- <path>`, chat mentions listing a whole tree to find one path. Each spawn blocks Electron's main thread for 2–6 ms inside `execFile` (fork), and costs about 3.4 ms in all; a request on a warm `cat-file --batch-command` costs about 0.05 ms (the task #30 investigation). beuve's minimum git, 2.36, is the release that added `--batch-command`.

The OpenAI-compatible adapter's read-only sandbox (ADR 0071) read the session checkout through the filesystem, checking a path and then opening it by path. The TOCTOU audit (finding 4) showed a directory swapped for a symbolic link between the two leaks files from outside the checkout (828 times in 48k reads), and that no portable fd-based fix exists in Node. The checkout itself is also slow to make (a cold `git worktree add` took 2–6.6 s on an 18.7k-file repository), and a chat request leased one for every model, including models with no tools at all.

## Decision

### `GitObjectReader` (`src/internal/git/git-object-reader.ts`)

- **Protocol.** One `git cat-file --batch-command --buffer` per repository root, started on first use. Requests are queued FIFO and written once per microtask as `info <spec>` / `contents <spec>` lines followed by one `flush`. Responses are matched to the head of the queue and framed by byte count (`<oid> <type> <size>\n<size bytes>\n`, or `<spec> missing` / `<spec> ambiguous`), so content is binary-safe; the parser holds at most one object. Anything else (a bad header, a size or object id that differs from the `info` before it, a missing trailing LF) is a desync.
- **API.** `info(spec, { signal })` answers `found` (object id, type, size), `missing` or `ambiguous`. `read(spec, { signal, maxBytes })` asks `info` first and then `contents <oid>` only when the size is within `maxBytes` (64 MiB by default), answering `content` (raw bytes), `too-large` (nothing crossed the pipe), `missing` or `ambiguous`. Both return a `Result` with a `GitError` and never reject.
- **Specs are structural** (`ObjectSpec`): `{ kind: 'object', oid }` (a full object id), `{ kind: 'path', commit, path }` (a full commit SHA and a branded `TreePath`) or `{ kind: 'ref', ref, peel: 'commit' | 'tree' }` (a branded `RevisionName` or a commit SHA). One bad line kills the process and every request queued behind it (`<rev>:../x` exits with "outside repository", `HEAD@{99}` with "log only has N entries"), and git 2.36 has no NUL-terminated input, so:
  - `parseTreePath` refuses empty, `.` and `..` segments, a leading `/`, leading or trailing whitespace, and every control character (newline, tab, and CR, which git's line reader strips);
  - `parseRevisionName` refuses `:`, `@{`, `{`, `}`, `..`, whitespace, `?*[\`, control characters and a leading character other than a letter, digit or `_`.
  - Each spec is validated again when its line is built, so a cast can't smuggle one in.
- **Hardening.** The same global options and environment as `execGit` (now `gitHardeningArgs` and `hardenedGitEnvironment`): no inherited `GIT_*`, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_REPLACE_OBJECTS=1`, no hooks or fsmonitor, the C locale. Never `--filters`, `--textconv` or `--follow-symlinks`: content is the raw blob, as diffs already show it.
- **Cancellation.** Every request is a `read` (ADR 0079), but a shared process can't be stopped for one request, so an abort **abandons** it: it answers `aborted` at once, an unsent request is dropped, and bytes already owed to a sent one are counted and skipped as they arrive.
- **Restarts** happen only when
  1. the process exits or desyncs: requests in flight are resent once to a fresh process (reads are idempotent), and a request in flight during a second crash fails with `command-failed`;
  2. the request at the head of the queue is unanswered past the request timeout (the handle's timeout, 30 s by default; a partial clone's lazy fetch is the likely cause): that request fails with `timeout`, the rest are resent;
  3. abandoned requests owe more than 64 MiB: a restart is cheaper than draining.

  The process is stopped by closing its input, or with SIGTERM (cat-file holds no locks), never SIGKILL.

- **Lifecycle.** `ObjectReaderPool` (`src/internal/git/object-reader-pool.ts`) keeps one reader per root and git binary. Main owns one in its `GitCaches` (ADR 0081) next to the probe cache, passes it to every `openRepository` through `OpenRepositoryOptions.objectReaders`, and disposes it in `MainServices.dispose` on quit. A reader is unreferenced while idle, so it never keeps the process alive, and stops after 30 s without a request (which also lets go of packs gc deleted). A handle opened without a pool (tests, one-off probes) starts its own reader on first use, which stops as soon as it is idle. If main dies, git sees EOF on stdin and exits.
- **Only behind `gitRunner`.** `GitRunner.objects` exposes `info` and `read`, bound to the handle's signal like `run` and `exec`. The pool hands a reader out only through a method keyed by the `gitRunner` symbol, and `git-object-reader.ts` and `stream-git.ts` join `exec-git`, `run-git` and `git-runner` in dependency-cruiser's `git-only-through-typed-operations`, so code outside the git domain reaches objects only through typed operations.
- **`GitRunner.stream`** (`streamGit`) runs a read with the usual hardening but hands stdout over as it arrives, and stops git with SIGTERM when the consumer says `stop`. `grepTree` uses it.

### What uses it, and what keeps spawning

| On the reader                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Still spawned                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveRevision` for a `RevisionName` (`info <rev>^{commit}`; refs are read afresh by every lookup, as ADR 0081 requires); `readBlobs` (all pipelined: `info`, then `contents` under the cap); `findTreeBlob` (the parent directory's tree object, parsed by `parseTreeObject`, gives the entry's mode and id); the new `readBlobBytes`. Through those: sheets, `getFilePair`, chat mentions (now `findTreeBlob` instead of listing the whole tree), ImpactGate's and the order's blob reads | `diff`, `merge-tree`, `merge-base`, `rev-list`, `ls-tree -r` (`listTreeBlobs`, `listTreePaths`), `git grep`, `check-attr`, `fetch`, the worktree commands; `resolveRevision` for a revision `parseRevisionName` refuses; `findTreeBlob` for a path `parseTreePath` refuses (`ls-tree -z`, whose default format never quotes) |

### The chat sandbox reads git objects (TOCTOU finding 4)

- `createReadOnlySandbox(tree, limits)` (`src/internal/llm`) takes a `SandboxTree` port instead of a directory. Main's `createSandboxTree` (`src/main/chat`) serves it at the request's pinned head:
  - the listing is `listTreeBlobs` (`ls-tree -r -z`, with modes), shared per root and commit in `GitCaches.treeFiles`, since a commit's tree never changes;
  - `read_file` reads by object id from that listing (`readBlobBytes`), so hostile names that the line protocol can't carry are read too;
  - `grep` is `grepTree`: `git grep -z -n -I -F --no-color --no-column --no-textconv --no-recurse-submodules -e <pattern> <sha> -- [<scope>]` on a validated full SHA (`git grep` has no `--end-of-options`), streamed and stopped one match past the cap.
- **Symbolic links** are blobs holding their target. `read_file` and a `grep` scope follow them by resolving every path component lexically inside the tree, at most 8 links; an absolute target or one that leaves the tree is refused. The filesystem is never touched. `glob` and `grep` list regular files only, as the filesystem walk did.
- **The tool contract stays**: the same names, schemas and caps (256 KiB shown per file, 2000 lines, 100 matches, 500 paths, 12 wildcards). The descriptions now say "tracked at the reviewed commit" and "case-sensitive". The 20,000-entry walk cap is gone (`maxEntries`); a file over 16 MiB (`maxBlobBytes`) is not read at all.
- **What the model sees differently**:
  - only files tracked at the commit: nothing written into the checkout after it was made (trace output, the user's editor, build output);
  - raw content: LFS pointer text, line endings as committed, `$Id$` unexpanded;
  - case-sensitive paths, also on macOS;
  - git's path order rather than the walk's breadth-first, `localeCompare` order, so a glob or grep that hits its cap can return a different first 500 or 100;
  - binary files are skipped by git's heuristic (a NUL in the first 8000 bytes) in `grep`; `read_file` still refuses a NUL anywhere in what it shows;
  - `ignore_case` folds ASCII only (`git grep -i` in the C locale).

### Chat requests lease a checkout only when a model reads one

- `ModelCapabilities.checkout` says whether an adapter reads `cwd` itself; `BaseModelRequest.cwd` is optional and `tree` carries the `SandboxTree`. The Claude Code and Agent SDK adapters refuse a request without `cwd`.
- Chat's `prepare` resolves the request's models first and leases the session checkout only if one of them has `checkout`. Main binds every model to the head's tree (`bindModelTree`), so the chat domain still builds requests without knowing where files come from; its `worktreePath` is optional.

| Model kind                      | Lease? | Why                                                                                                                                                                                        |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code CLI                 | Yes    | Claude Code's own `Read`, `Grep` and `Glob` read the checkout.                                                                                                                             |
| Agent SDK                       | Yes    | The SDK runs the same bundled Claude Code with the same built-in file tools on `cwd`. Serving it from objects would mean replacing them with in-process MCP tools; that is left for later. |
| OpenAI-compatible with tools    | No     | Its tools are the object-backed sandbox.                                                                                                                                                   |
| OpenAI-compatible without tools | No     | It reads nothing.                                                                                                                                                                          |

A `/review` whose review and verify models differ leases if either needs it. The language servers, trace probes and the editor keep their leases (ADR 0079).

## Consequences

- Single-object reads and ref lookups cost a pipe round trip instead of a spawn, and main's thread no longer blocks in `fork` for them. Measured on the 18.7k-file benchmark repository (326 changed files, Linux, two runs each, against `main` with ADR 0081's caches):

  | Scenario                                     | Before                                        | After                          |
  | -------------------------------------------- | --------------------------------------------- | ------------------------------ |
  | Large review: spawns                         | 212                                           | 20, plus 2,496 reader requests |
  | Large review: main thread blocked in spawn   | 1.13–1.20 s                                   | 0.10 s                         |
  | `getFilePair` ×10 (hunk expansion)           | 270–308 ms, 40 spawns                         | 9–10 ms, none                  |
  | Sheets ×3                                    | 341–411 ms, 47 spawns                         | 46–50 ms, 3 spawns             |
  | LSP peek ×3                                  | 136–157 ms, 15 spawns                         | 31 ms, none                    |
  | Chat `/review`, OpenAI-compatible with tools | 7.7 s, 13 spawns (3.7 s of it `worktree add`) | 2.2 s, 7 spawns, no checkout   |

  A new long-lived process type exists, with its own failure modes, kept to the restart rules above and covered by hold-until-signal and crashing-wrapper tests (`git-object-reader.test.ts`).

- Head-of-line blocking: one reader per root is serial, so a large blob read delays the reads behind it; `read`'s cap and `info` first bound it.
- Loose refs, packed refs, deletions, new objects and repacks stay fresh, and so does the reftable backend (see the amendment below).
- A long-lived reader keeps file descriptors on packs gc deleted until it idles out.
- The sandbox closes the symlink-swap race by construction, and a test that swaps a directory for a link to outside the checkout while reading proves it (`create-sandbox-tree.test.ts`). An OpenAI-compatible chat request no longer waits for a cold checkout.
- New single-object reads go through the reader: a typed operation on `GitRunner.objects`, never a one-off `cat-file`.

## Amendment 2026-10-31: the reftable backend, and a stale `packed-refs` on the files backend

- **Reftable is verified.** `git-object-reader.test.ts` runs the reader's ref behaviours against a repository from the `newestGitRepo` fixture: lookups of branches, tags (annotated ones peeled), `HEAD` and full ref names; refs moved, made and deleted by other git processes while the reader runs, including a writer moving a ref 40 times under a stream of lookups (every answer is one of the two commits, never `missing` or a desync); auto-compaction from 30 single-ref writes and `git pack-refs --all` during and between reads; and `info`/`read` by `{ ref, peel }`. Every lookup stayed fresh, so nothing in the reader changed for reftable. (`git refs optimize`, git 2.52+, is what `pack-refs` runs on new gits; the tests use `pack-refs`, which every supported git has.)
- **Where it runs.** The fixture uses the newest of `git` on `PATH` and `BEUVE_TEST_GIT`, with `--ref-format=reftable` from git 2.45 and the files backend before, so the same tests pass on any machine without an `if` or a skip. CI's `ubuntu-latest` (ubuntu-26) and `macos-latest` (macos-26-arm64) images both ship git 2.56.0 (shown by a `git --version` step), and the check step sets `BEUVE_REQUIRE_REFTABLE=1`, which makes the fixture fail instead of falling back: the reftable tests run on both. They were developed against git 2.51.2 built from the release tarball, beside this machine's 2.43.0.
- **A reader bug on the files backend, found on the way and fixed.** A long-lived git keeps its parsed `packed-refs` until the file's stat data changes, and that check missed a rewrite of the same size within the same second: after `update-ref` of a packed ref and a `pack-refs` (or a `branch -d`, which also rewrites `packed-refs`), the reader answered the old commit, and kept answering it, until `packed-refs` changed again. It reproduced every time on git 2.43 and 2.51 under Linux. The reader now finds `packed-refs` once (`rev-parse --path-format=absolute --git-path packed-refs`, so linked worktrees use the common directory) and, before each write to cat-file, compares its device, inode, size and nanosecond times with what they were when the running process was last sent requests; on a change, the queue goes to a fresh process and the old one gets SIGTERM. That costs one `stat` per flush and a spawn per `packed-refs` rewrite; it is not counted as a restart. Reftable repositories have no `packed-refs`, so they never refresh. The test `sees a packed ref that pack-refs rewrote at the same size within the second` failed 5/5 without the check and passes with it.
