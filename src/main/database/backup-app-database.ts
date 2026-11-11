import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { backupDatabase } from '#sqlite/backup-database.ts';

/** Where {@link backupAppDatabase} writes, and the state it names the copy after. */
export interface BackupAppDatabaseOptions {
  /** `<userData>/backups`, created owner-only (0700) if missing. */
  readonly directory: string;
  /** The last migration the database has applied. */
  readonly lastAppliedId: string;
}

/** The copy {@link backupAppDatabase} wrote, and the older ones it removed (file names). */
export interface AppDatabaseBackup {
  readonly file: string;
  readonly removed: readonly string[];
}

/**
 * Copies beuve's database before it migrates (ADR 0137) to
 * `beuve-<UTC time>-<last applied migration>.db` in `options.directory`, owner-only, and removes
 * all but the newest {@link keptBackups} backups there. Throws if the copy fails: migrating without
 * one is what this exists to prevent.
 */
export function backupAppDatabase(
  db: DatabaseSync,
  options: BackupAppDatabaseOptions,
): AppDatabaseBackup {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const file = path.join(options.directory, backupName(options.lastAppliedId));
  backupDatabase(db, file);
  return { file, removed: pruneBackups(options.directory) };
}

/** How many backups `userData/backups` keeps. */
const keptBackups = 3;

/** `beuve-2026-11-11T120000.000Z-ura-0002-drop-impact-findings.db`: sorts by time, safe anywhere. */
const backupPattern = /^beuve-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z-[\w.-]+\.db$/u;

function backupName(lastAppliedId: string): string {
  const time = Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }).replaceAll(':', '');
  return `beuve-${time}-${lastAppliedId.replaceAll(/[^\w.-]/gu, '_')}.db`;
}

function pruneBackups(directory: string): string[] {
  const stale = readdirSync(directory)
    .filter((name) => backupPattern.test(name))
    .toSorted((a, b) => b.localeCompare(a))
    .slice(keptBackups);
  for (const name of stale) {
    rmSync(path.join(directory, name), { force: true });
  }
  return stale;
}
