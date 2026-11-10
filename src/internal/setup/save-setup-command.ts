import type { DatabaseSync } from 'node:sqlite';

import type { SetupCommandRecord } from './setup-record.ts';

/** What {@link saveSetupCommand} stores: a repository and its already parsed command. */
export interface SetupCommandChange {
  readonly repository: string;
  readonly command: string;
}

/** Stores `change.command` as the repository's setup command, replacing any earlier one. */
export function saveSetupCommand(db: DatabaseSync, change: SetupCommandChange): SetupCommandRecord {
  const record: SetupCommandRecord = {
    repository: change.repository.toLowerCase(),
    command: change.command,
    updatedAt: Temporal.Now.instant().toString({ fractionalSecondDigits: 3 }),
  };
  db.prepare(
    `INSERT INTO setup_commands (repository, command, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (repository) DO UPDATE SET command = excluded.command,
        updated_at = excluded.updated_at;`,
  ).run(record.repository, record.command, record.updatedAt);
  return record;
}
