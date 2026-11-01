import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Schema changes for domains that no longer exist, so databases written by earlier versions lose
 * their tables. `trust_grants` held the per-repository trust grant that gated trace probes and
 * dependency installs (ADR 0090, removed by ADR 0096). Databases created since never had the table.
 */
export const retiredMigrations: readonly Migration[] = [
  {
    id: 'trust-0002-drop-grants',
    up: 'DROP TABLE IF EXISTS trust_grants;',
  },
];
