import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Schema changes for domains that no longer exist, so databases written by earlier versions lose
 * their tables and rows. `trust_grants` held the per-repository trust grant that gated trace probes
 * and dependency installs (ADR 0090, removed by ADR 0096). `ura_items` rows with the
 * `impact-finding` origin were staged ImpactGate findings (ADR 0015, removed by ADR 0102); the
 * origin no longer exists, so a stored one would make its session's list read as corrupt.
 * Databases created since never had either.
 */
export const retiredMigrations: readonly Migration[] = [
  {
    id: 'trust-0002-drop-grants',
    up: 'DROP TABLE IF EXISTS trust_grants;',
  },
  {
    id: 'ura-0002-drop-impact-findings',
    up: "DELETE FROM ura_items WHERE origin_kind = 'impact-finding';",
  },
];
