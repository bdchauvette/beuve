import type { DatabaseSync } from 'node:sqlite';

import type { InstallDecision } from './dependency-install.ts';

/** Records the safeguard's answer for a session head, replacing an earlier one (ADR 0090). */
export function saveInstallDecision(db: DatabaseSync, decision: InstallDecision): void {
  db.prepare(
    `INSERT INTO dependency_decisions (session_id, head_sha, decision, inputs, decided_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (session_id, head_sha) DO UPDATE SET
        decision = excluded.decision, inputs = excluded.inputs, decided_at = excluded.decided_at;`,
  ).run(
    decision.sessionId,
    decision.headSha,
    decision.decision,
    JSON.stringify(decision.inputs),
    decision.decidedAt,
  );
}
