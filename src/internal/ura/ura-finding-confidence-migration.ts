import type { Migration } from '#sqlite/run-migrations.ts';

/**
 * Keeps a staged `/review` finding's confidence (ADR 0142): the model's own 0–1 figure, so a
 * posted note can say how sure the agent was. Only a finding has one; items staged before this
 * column existed, and every other origin, hold NULL. It is a migration of its own, appended after
 * every domain's earlier ones (ADR 0006 amendment 2026-11-18), so every database applies the same
 * sequence.
 */
export const uraFindingConfidenceMigration: Migration = {
  id: 'ura-0003-finding-confidence',
  up: `
    ALTER TABLE ura_items ADD COLUMN chat_confidence REAL
      CHECK (chat_confidence IS NULL
        OR (chat_finding IS NOT NULL AND chat_confidence >= 0 AND chat_confidence <= 1));
  `,
};
