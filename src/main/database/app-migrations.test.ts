import { createHash } from 'node:crypto';

import type { Migration } from '#sqlite/run-migrations.ts';

import { appMigrations } from './app-migrations.ts';
import { test } from '../testing/test.ts';

test('never edits a migration that has shipped; a schema change is a new one', ({ expect }) => {
  expect(
    Object.fromEntries(
      appMigrations.map((migration) => {
        return [migration.id, fingerprintOf(migration)];
      }),
    ),
  ).toStrictEqual(shippedMigrations());
});

/**
 * Every migration, by id, with a fingerprint of its SQL (ADR 0006 amendment 2026-11-11). Append a
 * new migration's line; never change a line already here, because databases that ran it keep its
 * schema. A function migration is pinned by id only: its compiled text changes with the toolchain.
 */
function shippedMigrations(): Record<string, string> {
  return {
    'session-0001-initial': '8fc7431258c96edb',
    'ura-0001-initial': 'ef3e0595c6f67a89',
    'chat-0001-initial': 'ec7c29ba45f88ad8',
    'chat-0002-message-parts': 'function',
    'github-0001-initial': 'c94acc3c4c21887b',
    'review-edits-0001-initial': '3a3ec7a126f466a8',
    'setup-0001-initial': 'c35af3cb07ed9eb1',
    'trust-0002-drop-grants': 'c63f49d2490a652d',
    'ura-0002-drop-impact-findings': 'e98b3a255e786eda',
  };
}

function fingerprintOf(migration: Migration): string {
  if (typeof migration.up !== 'string') {
    return 'function';
  }
  return createHash('sha256').update(migration.up).digest('hex').slice(0, 16);
}
