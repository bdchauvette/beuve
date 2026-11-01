import type { DatabaseSync } from 'node:sqlite';

import type { InstallDecision } from './dependency-install.ts';

/** What the reviewer answered at the safeguard for this session head, if anything. */
export interface DecisionKey {
  readonly sessionId: string;
  readonly headSha: string;
}

/** The recorded answer for a session head, or `undefined` when the reviewer wasn't asked yet. */
export function findInstallDecision(
  db: DatabaseSync,
  { sessionId, headSha }: DecisionKey,
): InstallDecision | undefined {
  const row = db
    .prepare('SELECT * FROM dependency_decisions WHERE session_id = ? AND head_sha = ?;')
    .get(sessionId, headSha);
  if (row === undefined) {
    return undefined;
  }
  const decision = String(row['decision']);
  if (decision !== 'install' && decision !== 'decline') {
    return undefined;
  }
  return {
    sessionId,
    headSha,
    decision,
    inputs: inputsFrom(String(row['inputs'])),
    decidedAt: String(row['decided_at']),
  };
}

function inputsFrom(text: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}
