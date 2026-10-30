# 0076. `using` releases resources; `finally` is for bookkeeping

- Status: Accepted
- Date: 2026-10-30

## Context

beuve's runners release a lot by hand: timers, abort listeners, temporary directories, file handles and the process groups of `claude`, Vitest and language servers. The pattern was a `setTimeout` plus `clearTimeout`, an `addEventListener` plus `removeEventListener`, and a `try`/`finally` around the rest. It was easy to get wrong. The Claude Code runner cleaned up at the end of the function, not in a `finally`, so a throw between spawn and exit would have left its timer, its listener and the process group behind. A timer set after the cleanup had already run (the last line of output can still stop the run) was never cleared. Each runner also kept its own `termination` variable so it could tell its own timeout apart from the caller's cancellation.

Explicit resource management fixes this in the language. All the runtimes have it, checked on the real binaries and not from memory:

- **Electron 45's main process (Node 24.22.1):** `DisposableStack`, `AsyncDisposableStack`, native `using` and `await using`, `fs.promises.mkdtempDisposable` and `fs.mkdtempDisposableSync`, and `Symbol.dispose` on `Timeout`, `ChildProcess`, `FileHandle` and `DatabaseSync`.
- **Node 26 (tests):** the same.
- **Chromium 156 (renderer and the sandboxed preloads):** the same language features.

TypeScript 6.0 declares them in `lib.esnext.disposable`. esbuild 0.28 passes `using` through for `chrome156`. For `node24` it lowers `using` to a helper, because its compatibility table starts at Node 25.

## Decision

- **`using` / `await using` for every value that has `Symbol.dispose` or `Symbol.asyncDispose` and is acquired and released in one scope:**
  - temporary directories (`await using dir = await mkdtempDisposable(prefix)`, then `dir.path`);
  - `FileHandle`s;
  - `DatabaseSync` handles in tests;
  - a timer that only has to stop when the scope ends (`using _timer = setTimeout(…)`). tsc wants the `_` on a binding that is never read, and `@typescript-eslint/no-unused-vars` takes `ignoreUsingDeclarations`.
- **A `DisposableStack` per call for cleanup that is not a disposable value.** Register each release right after you acquire what it releases:
  - `stack.defer(() => { clearTimeout(killTimer); })`;
  - listeners added with `{ signal }` from an `AbortController` the stack adopts and aborts (`stack.adopt(new AbortController(), (c) => { c.abort(); })`);
  - the final `SIGKILL` of a process group, deferred first so that it runs last. Killing a process group with a grace period stays custom code, but it is registered on the stack.

  Long-lived owners that are not scopes keep a stack too: each ImpactGate job holds one and disposes it when the job settles.

- **Deadlines are signals.** `timeoutSignal(duration)` (`#x/time/timeout-signal.ts`) is `AbortSignal.timeout` for a `Temporal.Duration`. It rounds up to whole milliseconds and clamps a negative duration to zero, because `AbortSignal.timeout` throws on a fraction or a negative number. Combine it with the caller's signal as `AbortSignal.any([request.signal, deadline])`; when there is no caller signal, use the deadline alone. To tell a timeout from a cancellation, compare reasons: `combined.reason === deadline.reason`. Don't test for a `TimeoutError` by name, because a caller's own `AbortSignal.timeout` would then pass as ours, and it is a cancellation. The timer does not keep the process alive and needs no clearing. A listener that does need removing is registered with a `{ signal }` the stack aborts. The OpenAI-compatible adapter passes the combined signal straight to `fetch` and has nothing left to clean up. Claude Code, the Agent SDK, the Vitest trace runner and JSON-RPC requests listen to it once.
- **A promise returned from a `using` scope disposes before it settles.** Write `return await` (`@typescript-eslint/return-await`, in `strictTypeChecked`, already requires it in a `using` scope).
- **`finally` stays for bookkeeping:** in-flight map deletes (the pull request poller, session worktrees, the trace job map, JSON-RPC's incoming requests), queue pumping (`KeyedQueue`), the settings write queue and counters (LSP's `#track`). These are not resources, and `using` would only hide them.
- **Lint, `local/prefer-using`.** It has two checks and needs type information.
  - **A `finally` whose every statement releases something.** That means `clearTimeout`, `clearInterval`, `rm` or `rmSync`, or a method call `close()`, `dispose()`, `disposeAsync()`, `kill(…)`, `removeEventListener(…)` or `[Symbol.dispose]()`, or an argument-less `delete()` or `remove()`. A `finally` that also does bookkeeping, or that branches, is left alone.
  - **A `const` or `let` whose type has a dispose symbol and that the same function frees by hand.** It is reported only when the value never escapes: every use is a member access in the declaring function, and none returns, stores, passes or captures it.

  A broader type-aware check ("every disposable `const` must be `using`") would flag every `spawn`, because `ChildProcess` is disposable, and every timer handed to a callback. In those cases the value is meant to outlive the scope, so the rule stays narrow. On the codebase it found nine sites, all of them real: four language-server tests, the chat and MCP tests, the Tree-sitter tree in `createSyntaxParser`, and two tests that closed a `DatabaseSync` after their assertions.

- **Tests.** The `closing` fixture also takes a `Disposable`, an `AsyncDisposable`, or anything with a `close()` or `dispose()` (synchronous or not), and releases them last in, first out, on an `AsyncDisposableStack`. A test registers what it built with `closing(…)` instead of wrapping its body in `try`/`finally`. `tempRoot` and `tempDir` use `mkdtempDisposableSync`. `TestRepository.cleanup` and `VitestFixture.cleanup` were never called, because their directories live under `tempDir`, so they are gone, and so is `createTestRepository`'s default home outside it.
- **Build.** The `node24` builds (main, the ImpactGate worker and the preloads) set esbuild's `supported: { using: true }`, so stack traces and debugging show the code as written. The renderer target is `chrome156`; it said `chrome140`, which was stale (ADR 0060 copied it).
- `CLAUDE.md` gets one line under Code style.

## Consequences

Every exit path now releases what a call acquired, including throws and early returns. Each runner's cleanup is one stack, in the order its parts were acquired, and the reader no longer has to match `set`/`clear` pairs. The Claude Code runner's cleanup is now in a scope, so a throw releases it too. A kill timer set after the process closed is cleared. Settings' model Test removes its scratch directory before it answers, where before it answered and removed the directory afterwards.

A timeout signal's timer is unreferenced, as `AbortSignal.timeout` always is. A pending JSON-RPC request no longer keeps the process alive on its own. Its streams, Electron and Vitest's worker still do. `AbortSignal.any` keeps sources and dependents alive weakly. A probe on Node 24.22.1 and 26 with forced garbage collection showed that a combined timeout still fires while a listener is attached, which is the only way these signals are used.

`using` needs a disposable value. Callbacks that settle a promise from either side (JSON-RPC's `settle`, `ServerSession.#nextEvent`) keep their release in the callback, through the listener controller.
