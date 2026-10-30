# 0050. Stable card properties, cached card heights and highlighting in workers

- Status: Accepted
- Date: 2026-10-30

## Context

A profiling pass in Electron 45 under Xvfb (software rendering, so absolute times are pessimistic; ratios are what count) found four renderer costs that grow with the review:

- Every stream render re-rendered every card. `renderReview` passed fresh arrays (`insights.filter(…)`, `findings ?? []`) and an O(n) `impact.files.find(…)` to each card, so every card saw a changed property and called `diff.render()` again: 304 card updates per `j` on a 305-file review.
- A card measured its diff with `getBoundingClientRect()` when it unmounted, forcing a synchronous layout per card while the first mount pass ran (1.3 s of self time in that one call at open).
- Shiki's JavaScript regex engine highlights on the main thread: one 6 s task for a 20 000-line added file, 1–2 s on large reviews.
- Lockfiles and giant patches render whole (ADR 0051, 0052).

## Decision

- **Stable properties.** The stream slices its arrays per file with `groupStable` (insights by path; URA items by the paths of their anchor and placement) and maps impact entries by path. Each slice is rebuilt only when its source array changes, and a file's slice keeps its previous array while its members are the same objects in the same order. Absent slices are shared constant empties. A card therefore updates only when its own data, `active` or `activeHunk` changes: `j`/`k` update one or two cards.
- **Cached heights.** A `ResizeObserver` on the mounted diff keeps its height; unmounting reads that instead of measuring. `estimateHeight` (which splits the patch) runs once per file.
- **Highlighting in workers.** Cards share one `@pierre/diffs/worker` `WorkerPoolManager` with two workers, created once the library has loaded and beuve's Alabaster themes are registered (the pool resolves registered themes on the main thread and sends them to the workers, so it must start after `registerCustomTheme`). Diffs up to 12 000 characters (both sides) still highlight on the main thread (`mainThreadMaxCharacters`): faster than a round trip and no plain-text pass. If the worker module or a worker fails to start, cards highlight on the main thread as before. The worker is its own esbuild entry, `dist/ui/diff-worker/worker.js` with its own chunks and the same curated grammars and stubs; it can't be an entry of the code-split ui build, because the file has top-level side effects that splitting would hoist into a chunk the page also runs. `dist/**` already ships it, so `electron-builder.yml` is unchanged.
- **CSP: no change.** The worker is a same-origin module script, so with no `worker-src` the policy falls back to `script-src 'self'` (CSP 3: `worker-src` → `child-src` → `script-src`). This corrects ADR 0018, which assumed workers would need `worker-src`. Checked in development (`loadFile` over `file://`) and in the packaged app (`npm run dist:linux-dir`, `app.asar/dist/ui/diff-worker/worker.js`): two workers start, zero `securitypolicyviolation` events, and the highlighted tokens carry the Alabaster colours (`#325CC0` / `#71ADE7` definitions).

## Consequences

Measured with the harness of the profiling pass (`session:get-review` then `selectSession`, 30 `j`/`k`, a 20 s scroll at 100 px per frame), main before (`3a4a954`, two runs where repeated) and after this ADR with ADR 0051–0052 (and ADR 0053, which moved ImpactGate to a worker thread in main). "Rows" and "highlighted" are ms from opening the session to the first diff row and the first highlighted token; "open long tasks" is count / sum / longest.

| Scenario                               |                   | Rows        | Highlighted | Open long tasks                     | Layout at open | DOM nodes      | `j`/`k` p50 / p95 | Card updates per key | Scroll frame p50 / p95 / p99 |
| -------------------------------------- | ----------------- | ----------- | ----------- | ----------------------------------- | -------------- | -------------- | ----------------- | -------------------- | ---------------------------- |
| small (5 files)                        | before            | 488–517     | 488–517     | 3 / 0.4 s / 257–283 ms              | 36–40 ms       | 10 216         | 14 / 23–25        | 5                    | 16.7 / 16.7 / 16.8           |
|                                        | after             | 476         | 476         | 4 / 0.4 s / 237 ms                  | 44 ms          | 14 501         | 20 / 30           | 1.2                  | 16.7 / 16.7 / 16.8           |
| medium (60 files)                      | before            | 468–487     | 744–852     | 11 / 1.6 s / 454–524 ms             | 588–599 ms     | 41 500         | 33–38 / 53–63     | 60                   | 16.7 / 33 / 50–83            |
|                                        | after             | 466         | 1 031       | 9 / 1.1 s / 313 ms                  | 252 ms         | 48 019         | 34 / 50           | 1.6                  | 16.7 / 33 / 67               |
| large-nolock (304 files, four 5k-line) | before            | 728–830     | 1 039–1 268 | 13–23 / 3.3–4.1 s / 1 192–1 879 ms  | 1 353–2 280 ms | 97 500–104 258 | 54–71 / 94–115    | 304                  | 16.7 / 33–50 / 67–100        |
|                                        | after             | 726         | 2 410       | 10 / 1.5 s / 404 ms                 | 452 ms         | 107 276        | 42 / 73           | 1.0                  | 16.7 / 33 / 83               |
| large (+ 10k-row lockfile)             | before            | 692–777     | 1 061–2 199 | 16–20 / 7.6–11.0 s / 3 657–6 079 ms | 3 907–6 341 ms | 187 000        | 336–357 / 378–462 | 305                  | 150 / 200 / 217–267          |
|                                        | after             | 774         | 2 491       | 15 / 1.8 s / 376 ms                 | 479 ms         | 104 096        | 42 / 63           | 1.0                  | 16.7 / 50 / 100              |
|                                        | lockfile loaded   | 798         | 3 849       | 15 / 3.9 s / 1 103 ms               | 1 122 ms       | 233 171        | 333 / 368         | 1.0                  | 150 / 200 / 200              |
| huge (one 20k-line file, 150 hunks)    | before            | 1 120–1 275 | 1 120–1 275 | 3–4 / 1.3–1.4 s / 950–988 ms        | 155–164 ms     | 42 318         | 97–99 / 127–132   | 1                    | 16.7 / 33 / 33–50            |
|                                        | after             | 357         | 1 592       | 5 / 0.7 s / 245 ms                  | 219 ms         | 69 909         | 98 / 120          | 1                    | 16.7 / 33 / 50               |
| huge-added (20k lines, all added)      | before            | 5 951–6 201 | 5 952–6 202 | 5–6 / 8.1–8.3 s / 5 764–5 988 ms    | 917–946 ms     | 248 000        | 11–13 / 17–19     | 0                    | 83–100 / 183 / 217           |
|                                        | after (collapsed) | —           | —           | 0                                   | 13 ms          | 2 928          | 10 / 18           | 0                    | —                            |
|                                        | after, loaded     | 658         | 8 290       | 8 / 4.6 s / 1 821 ms                | 1 408 ms       | 384 892        | 10 / 19           | 0                    | 100 / 183 / 250              |

- Card updates per key are down to one or two; layout at open is 2–13 times smaller; the longest main-thread task at open is 1.5–16 times shorter, and rows appear 3–10 times sooner on giant files.
- Highlighting arrives later on big reviews (large-nolock 1.0–1.3 s → 2.4 s; huge-added loaded 6.2 s → 8.3 s): workers each compile the grammar on first use, and the plain text shows first. Small reviews highlight on the main thread as before.
- Scroll frames are unchanged within noise on reviews of ordinary files: the stream's cost there is per-mount layout and style, not script. Run-to-run noise on this machine is about ±30 % on scroll percentiles (two `medium` runs of the same build gave p99 67 and 83 ms), so we read only the large differences.
- A loaded giant card is still a whole card (ADR 0051): the loaded huge-added file scrolls as badly as before and has more nodes than the main-thread render had, which we have not explained yet.
