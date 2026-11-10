import type { DatabaseSync } from 'node:sqlite';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { SetupCommandRecord, SetupStoreError } from './setup-record.ts';

/** The setup command stored for `repository` (`host/owner/repo`), or `undefined` when none is. */
export function findSetupCommand(
  db: DatabaseSync,
  repository: string,
): Result<SetupCommandRecord | undefined, SetupStoreError> {
  const row = db
    .prepare('SELECT repository, command, updated_at FROM setup_commands WHERE repository = ?;')
    .get(repository.toLowerCase());
  if (row === undefined) {
    return ok(undefined);
  }
  const { command, updated_at } = row;
  const stored = row['repository'];
  if (typeof stored !== 'string' || typeof command !== 'string' || typeof updated_at !== 'string') {
    return err({ kind: 'corrupt-row', table: 'setup_commands', reason: 'a column is not text' });
  }
  return ok({ repository: stored, command, updatedAt: updated_at });
}
