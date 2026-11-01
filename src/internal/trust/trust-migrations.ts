import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * The trust domain's schema (ADR 0090). `trust_grants` holds one row per granted scope, keyed by
 * its kind and a kind-specific key (a repository's real path), with the whole scope as JSON. A new
 * scope kind is new rows under a new `kind`, not a migration. Nothing references it: revoking is a
 * delete, and grants outlive sessions.
 */
export const trustMigrations: readonly Migration[] = [
  {
    id: 'trust-0001-grants',
    up: `
      CREATE TABLE trust_grants (
        kind TEXT NOT NULL CHECK (kind <> ''),
        scope_key TEXT NOT NULL CHECK (scope_key <> ''),
        scope TEXT NOT NULL CHECK (json_valid(scope)),
        granted_at TEXT NOT NULL CHECK (granted_at <> ''),
        PRIMARY KEY (kind, scope_key)
      ) STRICT;
    `,
  },
];
