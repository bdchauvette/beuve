import type { DatabaseSync } from 'node:sqlite';

import type { SetupRun } from './setup-record.ts';

/** Where a setup just finished successfully. */
export interface SetupRunPlace {
  readonly sessionId: string;
  readonly headSha: string;
  readonly checkout: string;
}

/** Remembers that setup succeeded in `place.checkout`, replacing the session's earlier run. */
export function recordSetupRun(db: DatabaseSync, place: SetupRunPlace): SetupRun {
  const run: SetupRun = {
    ...place,
    finishedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  };
  db.prepare(
    `INSERT INTO setup_runs (session_id, head_sha, checkout, finished_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET head_sha = excluded.head_sha,
        checkout = excluded.checkout, finished_at = excluded.finished_at;`,
  ).run(run.sessionId, run.headSha, run.checkout, run.finishedAt);
  return run;
}
