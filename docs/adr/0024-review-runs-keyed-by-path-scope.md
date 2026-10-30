# 0024. Review runs are keyed by path scope; statuses survive reruns

- Status: Superseded by [0055](0055-review-folded-into-chat-with-verification.md); the reuse rule (same head and normalized path scope, effort not part of it, `--fresh` reruns) survives over the transcript
- Date: 2026-10-28

## Context

ADR 0022 stored one run per (session, head). So `/review src/auth.ts` reused an earlier whole-change run, a scoped run was reused for a later plain `/review`, and `--fresh` deleted the old insights together with the reviewer's promoted and dismissed marks.

## Decision

- **Key**: a run is unique per (session, head, path scope). The path scope is the normalized prefix set (`normalizePathScope`): each prefix cleaned of `.`, empty and trailing segments, then sorted, de-duplicated, and with prefixes covered by a shorter one dropped (`src/auth.ts` under `src` adds no file). `[]` is the whole change. Effort and model are not in the key: they are quality knobs, not different questions, so `/review --effort=high` after a stored run reuses it, and `--fresh` reruns it. The store keeps the scope in `review_runs.path_scope` (a JSON array; `scope` stays `full | interdiff`). Migration `review-0002-run-path-scope` rebuilds both tables, since SQLite cannot drop the old `UNIQUE (session_id, head_sha)` and dropping `review_runs` would cascade-delete insights. Runs stored before it did not record their prefixes and become whole-change runs.
- **Reuse**: a request reuses only the run with exactly its scope. A plain `/review` reuses a whole-change run only; a scoped run never answers a different scope.
- **Listing**: `review:list-insights` returns the insights of all runs at the head, every status, ordered by path and line. Insights from overlapping runs that match (same path, same line range, same category, same normalized title) appear once, as the newest run found them. `run` is the newest run at the head.
- **One run in flight per session**: a request for the same scope attaches; any other request (another scope, or `--fresh`) aborts the in-flight run as `superseded` and starts its own, unless a stored run answers it. This is simpler than queueing, and the typical reviewer narrows or widens the question rather than asking two at once.
- **Status carry-over**: when a run is stored (`insertReviewRun`, and `replaceReviewRun` for `--fresh`) each new insight that matches a decided insight stored at the same head, in any run, takes its status. Matching (`matchesInsight`) is conservative: same path, overlapping lines, same category, and equal titles after case, punctuation and whitespace are ignored. A reworded title is a new insight. The newest decided match wins. This also stops a scoped run from resurrecting an insight the reviewer already dismissed in the whole-change run.

## Consequences

- Several runs per head cost several model calls; each is explicit, and reuse needs an identical scope.
- Changing only effort never reruns by itself, and a rerun does not honor the old run's effort.
- Carry-over cannot follow an insight whose title the model rewords, or across heads.

## Amendment 2026-10-29: migrations squashed

Squashed into `review-0001-initial` (ADR 0006); the schema described here is unchanged, and no upgrade step exists. `review_runs` is created with `path_scope` from the start; the table rebuild and the whole-change treatment of earlier runs are gone.
