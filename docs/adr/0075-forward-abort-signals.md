# 0075. Forward abort signals: `local/forward-abort-signal`

- Status: Accepted
- Date: 2026-10-30

## Context

Cancellation in beuve is an `AbortSignal`: a chat request's controller (ADR 0057), a trace job's (ADR 0041), ImpactGate's runs (ADR 0053), a component's connection (ADR 0074), a Vitest test's context. A signal only cancels what it reaches. Calls that could take one often did not get it: tests built model requests, GitHub requests and JSON-RPC calls without their context's `signal`, so a timed-out test left its fake servers and child processes running, and git, the busiest child process, could not be cancelled at all. Nothing pointed these out; review missed them because the call looks complete without its last argument.

## Decision

- **A type-aware rule**, `local/forward-abort-signal`, applies to every file. It reports a call or `new` whose resolved signature takes an `AbortSignal`, as a parameter whose type includes `AbortSignal` or as an options bag with a `signal` property whose type does, when the call passes none and a signal is in scope.
- **In scope**, at the nearest enclosing function that has any (an inner function's signal wins over its caller's):
  - a parameter typed `AbortSignal`, or a destructured binding of that type (`{ signal }`);
  - a parameter whose type has a `signal` property: an options bag (`options.signal`, `options?.signal`), an `AbortController`, a `Request`, the Vitest test or fixture context (`context.signal`); a destructured one that leaves `signal` out, as most tests do, counts as `signal` and the fix adds it to the pattern;
  - a local variable typed `AbortSignal` or `AbortController` (`controller.signal`) declared before the call;
  - a class field typed `AbortSignal` or `AbortController` that the same method reads (`this.field`, or `this.field.signal` for a controller), as `ActionDelegation` does. A field the method never reads does not count: a controller for one load is not every method's.
  - Module-level signals never count. A local signal derived from another (`const bounded = AbortSignal.any([signal, …])`) replaces it.
- **Passing** means: any argument where a signal parameter is; an object literal with `signal` or a spread; a non-literal bag whose type has a `signal` (it may carry one); or a signal in scope anywhere in the arguments (`once(signal, 'abort')`). `AbortSignal.any([…])` must include a signal in scope. A non-object value where the bag goes (`addEventListener(type, f, true)`, `readFile(path, 'utf8')`) is reported without a fix.
- **Not reported:** methods of a signal itself (`signal.addEventListener('abort', …, { signal })` would remove the listener before it runs), and Node's `…Sync` functions, whose options type includes `signal` but which ignore it.
- **Fixes** apply only when exactly one signal is in scope and the bag is an object literal or absent (skipped optional parameters become `undefined`). Two signals are reported with both names, for a person to choose.
- **Exceptions are disables with a reason**, on the line: work that must outlive the caller, or cancellation handled another way. The trace runner is the only one: it stops Vitest's whole process group itself, and its temporary files are answered by that stop.
- **A callee that ignores a signal says so in its type.** `buildGithubHttpRequest` takes `Omit<GithubRequest, 'signal'>`, since it only builds the request.
- **Signals added** where cancellable I/O had none: `GitRequest.signal` for `execGit`/`runGit` (git is killed and the call fails with a new `aborted` `GitError`), `GitRepository.run(args, { signal })` and `exec`'s `signal`, `OpenRepositoryOptions.signal` bounding every command a handle runs (a call's own adds to it), `fetchRefs`'s `signal`, `syncPullRequestHead`'s and `fetchPullRequest`'s. The pull request poller aborts its requests and fetches on `dispose`. Test fixtures pass the test's signal: `repo.git(…)` (`openTestRepository(home, signal)`), copies of repository templates (not their shared builds), and `repository`. Optional `signal` options are typed `AbortSignal | undefined`, so an optional signal forwards without a conditional spread.

## Consequences

A cancellation now reaches the work it bounds: a test that times out kills its git and fake model processes, and quitting stops a poll mid-fetch. Most call sites gain `{ signal }`, and most tests destructure `signal`. Vitest aborts a test's signal only on timeout or cancellation, not when the test passes, so passing tests behave as before.

The rule trusts a non-literal options bag whose type declares `signal`, so `openRepository(path, settings)` passes even when `settings` carries none, and it does not see a signal reached through another object (`job.controller.signal`); those stay review's job. A signal parameter that is not a cancellation (one a function only inspects) is still forwarded to, which is harmless. The rule resolves a signature per call, which adds a few seconds to a full lint.
