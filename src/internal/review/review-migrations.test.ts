import { describe, expect, it } from 'vitest';

import type { SessionId } from './agent-insight.ts';
import { openDatabase } from '#pkg/sqlite/open-database.ts';
import { runMigrations } from '#pkg/sqlite/run-migrations.ts';

import { listAgentInsights } from './list-agent-insights.ts';
import { reviewMigrations } from './review-migrations.ts';
import { createReviewTestDatabase } from './testing/create-review-test-database.ts';

const session = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(40);
const at = '2026-10-28T12:00:00.000Z';

const checkFailed = /CHECK/u;
const uniqueFailed = /UNIQUE/u;
const foreignKeyFailed = /FOREIGN KEY/u;

/** Column values as SQL literals. */
const validRun = {
  id: `'${run}'`,
  session_id: `'${session}'`,
  scope: "'full'",
  base_sha: `'${sha}'`,
  head_sha: `'${sha}'`,
  from_head_sha: 'NULL',
  model: "'m'",
  insight_count: '0',
  dropped_count: '0',
  created_at: `'${at}'`,
};

const insightId = '33333333-3333-4333-8333-333333333333';

const validInsight = {
  id: `'${insightId}'`,
  run_id: `'${run}'`,
  session_id: `'${session}'`,
  head_sha: `'${sha}'`,
  path: "'src/a.ts'",
  line_start: '1',
  line_end: '2',
  severity: "'risk'",
  category: "'security'",
  title: "'t'",
  body: "'b'",
  confidence: '0.5',
  status: "'pending'",
  created_at: `'${at}'`,
};

function insertSql(table: string, row: Readonly<Record<string, string>>): string {
  return `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).join(', ')});`;
}

describe('reviewMigrations', () => {
  it('accepts valid rows', () => {
    const db = createReviewTestDatabase([session]);
    db.exec(insertSql('review_runs', validRun));
    db.exec(insertSql('agent_insights', validInsight));
    expect(db.prepare('SELECT status FROM agent_insights;').get()).toEqual({ status: 'pending' });
  });

  it.each([
    ['scope', "'partial'"],
    ['base_sha', "'ABC'"],
    ['from_head_sha', `'${sha}'`],
    ['model', "' '"],
    ['insight_count', '-1'],
    ['created_at', "'yesterday'"],
  ])('rejects a run with an invalid %s', (column, value) => {
    const db = createReviewTestDatabase([session]);
    expect(() => {
      db.exec(insertSql('review_runs', { ...validRun, [column]: value }));
    }).toThrow(checkFailed);
  });

  it('requires a previous head exactly for interdiff runs', () => {
    const db = createReviewTestDatabase([session]);
    expect(() => {
      db.exec(insertSql('review_runs', { ...validRun, scope: "'interdiff'" }));
    }).toThrow(checkFailed);
    db.exec(
      insertSql('review_runs', { ...validRun, scope: "'interdiff'", from_head_sha: `'${sha}'` }),
    );
  });

  it.each([
    ['line_start', '0'],
    ['line_end', '0'],
    ['severity', "'critical'"],
    ['category', "'style'"],
    ['title', "'  '"],
    ['body', "''"],
    ['confidence', '1.5'],
    ['status', "'pending_review'"],
    ['path', "''"],
  ])('rejects an insight with an invalid %s', (column, value) => {
    const db = createReviewTestDatabase([session]);
    db.exec(insertSql('review_runs', validRun));
    expect(() => {
      db.exec(insertSql('agent_insights', { ...validInsight, [column]: value }));
    }).toThrow(checkFailed);
  });

  it('requires the session to exist', () => {
    const db = createReviewTestDatabase([]);
    expect(() => {
      db.exec(insertSql('review_runs', validRun));
    }).toThrow(foreignKeyFailed);
  });

  it('surfaces rows that break the domain model as corrupt instead of casting', () => {
    const db = createReviewTestDatabase([session]);
    db.exec(insertSql('review_runs', validRun));
    db.exec(insertSql('agent_insights', validInsight));
    db.exec('PRAGMA ignore_check_constraints = ON;');
    db.exec("UPDATE agent_insights SET severity = 'critical';");
    expect(listAgentInsights(db, session as SessionId, sha as never)).toEqual({
      ok: false,
      error: {
        kind: 'corrupt-row',
        table: 'agent_insights',
        id: insightId,
        reason: 'severity or category is unknown',
      },
    });
  });

  it('migrates stored runs and insights to whole-change runs, keeping the foreign keys', () => {
    const db = openDatabase(':memory:');
    const stub = { id: 'test-0000', up: 'CREATE TABLE sessions (id TEXT PRIMARY KEY) STRICT;' };
    const [first, second] = reviewMigrations;
    runMigrations(db, [stub, first as never]);
    db.exec(`INSERT INTO sessions (id) VALUES ('${session}');`);
    db.exec(insertSql('review_runs', { ...validRun }));
    db.exec(insertSql('agent_insights', { ...validInsight, status: "'dismissed'" }));

    expect(runMigrations(db, [stub, first as never, second as never])).toEqual([
      'review-0002-run-path-scope',
    ]);

    expect(db.prepare('SELECT id, path_scope FROM review_runs;').all()).toEqual([
      { id: run, path_scope: '[]' },
    ]);
    expect(db.prepare('SELECT run_id, status FROM agent_insights;').all()).toEqual([
      { run_id: run, status: 'dismissed' },
    ]);
    db.exec(
      insertSql('review_runs', {
        ...validRun,
        id: "'99999999-9999-4999-8999-999999999999'",
        path_scope: `'["src"]'`,
      }),
    );
    expect(() => {
      db.exec(
        insertSql('review_runs', {
          ...validRun,
          id: "'88888888-8888-4888-8888-888888888888'",
        }),
      );
    }).toThrow(uniqueFailed);
    expect(() => {
      db.exec(insertSql('review_runs', { ...validRun, path_scope: "'{}'" }));
    }).toThrow(checkFailed);
    db.prepare('DELETE FROM review_runs WHERE id = ?;').run(run);
    expect(db.prepare('SELECT count(*) AS n FROM agent_insights;').get()).toEqual({ n: 0 });
    expect(db.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
  });
});
