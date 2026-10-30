# 0053. ImpactGate runs in a worker thread and ships a slim view

- Status: Accepted
- Date: 2026-10-29

## Context

ADR 0014 left parsing on the calling thread and named a `worker_thread` as the way out. A cold `session:get-impact` on a 300-file review parsed for about 4 s inside main, in stalls of 0.5 to 2.9 s, during which every other IPC channel, chunk load and window event waited. The reply was also 3.4 MB (one 20,000-line file carried 1.6 MB of function rows), although the renderer reads a small part of it.

## Decision

- **One worker.** `src/main/impact/impact-worker.ts` is a second esbuild entry (`dist/main/impact-worker.js`, ADR 0007) that main starts by path. It creates the syntax parser (ADR 0014) and runs `runImpactCheck` (ADR 0015). The domains are unchanged. `createImpactWorker` owns one long-lived worker: started on the first run, unref'd, replaced after a crash or a cancellation, terminated by `dispose` on quit. Runs are serial; each request carries the blob texts and changed ranges and gets back a plain `ImpactReport`.
- **Failure and cancellation.** A crash or a worker error fails only the run in progress (`internal`, not cached); queued runs go to a fresh worker. `observeHead` aborts a session's in-flight computation when its head moves (`stale-review`): a queued run is dropped, a running one ends by terminating the worker, which costs a restart and a grammar reload (about 0.2 s) and is cheap next to a stale 4 s parse.
- **Assets.** The worker receives `wasmDirectory` through `workerData`, so it loads the same `dist/main/wasm/` files as main did. Under vitest and `node` it runs the TypeScript source beside `create-impact-worker.ts`. In the packaged app both the script and the wasm load from inside `app.asar` with no `asarUnpack` entry (checked with `dist:linux-dir`).
- **Slim view.** `session:get-impact` returns `getImpactForRenderer`: per file the aggregate and the eight worst changed functions (the popover's rows and the tree's percentile), with `omittedFunctions` counting the rest. Findings, totals and percentiles are unchanged. MCP `beuve_run_impact_check` and main-side consumers use `getImpact`, the full view, from the same cached worker result. Only a file with more than eight changed functions sees a difference.
- The renderer still fetches lazily after the review renders; the call now resolves when the worker answers and blocks nothing meanwhile.

## Consequences

On the 304-file synthetic review, main's worst event-loop stall during a cold computation fell from 0.5 to 0.9 s (up to 2.9 s in the earlier measurement) to about 30 ms, and the reply from 3.4 MB to 243 KB. Total latency is unchanged, because the work is the same and still serial. Texts are structured-cloned to the worker (a memcpy of the blobs) and the report back. The worker's wasm instance is separate from main's, which still parses for trace probes. Parallel workers are a later option if one review's latency matters.

## Amendment 2026-10-30: a head move also cancels a request still loading its diff

`observeHead` aborts only computations already registered, so a `getImpact` that was still loading its diff when the head moved went on to answer for the superseded head. `getImpact` now notes the head observations made while it loaded and answers `stale-review` if one names a different head than the diff it loaded. The head-move test holds the run in an injected `ImpactRunner` (`impactRunner` in `createMainServices`) and awaits its start instead of sleeping, which had made it fail on slow macOS runners (and would fail on fast machines that finished first).
