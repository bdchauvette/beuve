import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';

import { appMigrations } from '../src/main/database/app-migrations.ts';
import { openDatabase } from '../src/sqlite/open-database.ts';
import { runMigrations } from '../src/sqlite/run-migrations.ts';

await writeSchemaFixture();

/**
 * Writes `src/main/database/testing/schema-fixtures/<last migration id>.sql`: a fresh database
 * with every migration in `appMigrations`, representative rows in every table, as SQL that
 * rebuilds it (ADR 0006 amendment 2026-11-11). Run it when a release is tagged whose last
 * migration has no fixture yet, after updating `seedRows` for any table or column the release
 * added. It never replaces a fixture: one that shipped is frozen.
 */
async function writeSchemaFixture(): Promise<void> {
  const lastId = appMigrations.at(-1)?.id ?? 'empty';
  const directory = path.join(import.meta.dirname, '../src/main/database/testing/schema-fixtures');
  const target = path.join(directory, `${lastId}.sql`);
  using db = openDatabase(':memory:');
  runMigrations(db, appMigrations);
  db.exec(seedRows());
  db.exec(`UPDATE schema_migrations SET applied_at = '${at(0)}';`);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await writeFile(target, dumpOf(db, lastId), { flag: 'wx', mode: 0o644 });
  process.stdout.write(`${path.relative(process.cwd(), target)}\n`);
}

/** SQL that rebuilds `db`: its tables, indexes and triggers, then every row, table by table. */
function dumpOf(db: DatabaseSync, lastId: string): string {
  const objects = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_schema
       WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*'
       ORDER BY rowid;`,
    )
    .all();
  const tables = objects
    .filter((object) => {
      return object['type'] === 'table';
    })
    .map((object) => {
      return String(object['name']);
    });
  return [
    `-- A beuve database at migration ${lastId}, with representative rows in every table.`,
    '-- Written by `node scripts/write-schema-fixture.ts`. Never edit it: it stands for databases',
    '-- that exist, and app-migrations.test.ts upgrades it (ADR 0006 amendment 2026-11-11).',
    'BEGIN;',
    ...objects.map((object) => {
      return `${String(object['sql'])};`;
    }),
    ...tables.flatMap((table) => {
      return insertsOf(db, table);
    }),
    'COMMIT;',
    '',
  ].join('\n');
}

function insertsOf(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`SELECT * FROM ${quotedName(table)} ORDER BY rowid;`)
    .all()
    .map((row) => {
      const names = Object.keys(row)
        .map((name) => quotedName(name))
        .join(', ');
      const values = Object.values(row)
        .map((value) => literalOf(value))
        .join(', ');
      return `INSERT INTO ${quotedName(table)} (${names}) VALUES (${values});`;
    });
}

function quotedName(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function literalOf(value: SQLOutputValue): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "''")}'`;
  }
  if (value instanceof Uint8Array) {
    return `X'${value.toHex()}'`;
  }
  return String(value);
}

/**
 * One or more rows for every table, covering each kind, origin, label, status and part the
 * schema allows, so a migration that rewrites rows meets each shape a reviewer's database holds.
 */
function seedRows(): string {
  return [sessionRows(), uraRows(), chatRows(), githubRows(), reviewEditRows(), setupRows()].join(
    '\n',
  );
}

function sessionRows(): string {
  return `
    INSERT INTO sessions (id, kind, repo_path, base_ref, head_ref, owner, repo, pr_number, head_sha,
                          created_at, updated_at, host, forge, branch)
    VALUES
      ('${id(1)}', 'local', '/Users/reviewer/src/café app', 'main', 'feature/notes', NULL, NULL,
       NULL, '${sha(1)}', '${at(1)}', '${at(9)}', NULL, NULL, NULL),
      ('${id(2)}', 'github-pull-request', '/Users/reviewer/src/beuve', 'main', NULL, 'octo',
       'beuve', 42, '${sha(2)}', '${at(2)}', '${at(8)}', 'github.com', NULL, NULL),
      ('${id(3)}', 'remote-branch', '/Users/reviewer/src/other', 'origin/main', NULL, 'octo',
       'other', NULL, '${sha256(3)}', '${at(3)}', '${at(7)}', 'github.com', 'github', 'topic/fix');

    INSERT INTO checkpoints (id, session_id, base_sha, head_sha, created_at)
    VALUES
      ('${id(11)}', '${id(1)}', '${sha(9)}', '${sha(1)}', '${at(1)}'),
      ('${id(12)}', '${id(2)}', '${sha(9)}', '${sha(4)}', '${at(2)}'),
      ('${id(13)}', '${id(2)}', '${sha(9)}', '${sha(2)}', '${at(6)}'),
      ('${id(14)}', '${id(3)}', '${sha256(9)}', '${sha256(3)}', '${at(3)}');

    INSERT INTO file_marks (session_id, path, diff_id, head_sha, marked_at)
    VALUES
      ('${id(1)}', 'src/a.ts', '${sha256(5)}', '${sha(1)}', '${at(4)}'),
      ('${id(2)}', 'docs/read me.md', '${sha256(6)}', '${sha(2)}', '${at(6)}');
  `;
}

function uraRows(): string {
  const patch = [
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,1 +3,1 @@',
    '-  for (let i = 0; i < n - 1; i++) {',
    '+  for (let i = 0; i < n; i++) {',
    '',
  ].join('\n');
  return `
    INSERT INTO ura_items (id, session_id, position, head_sha, anchor_kind, path, line_start,
                           line_end, severity, blocking, origin_kind, chat_message_id,
                           chat_finding, chat_proposal, title, body, patch, status, addressed_sha,
                           addressed_by, created_at, updated_at)
    VALUES
      ('${id(21)}', '${id(1)}', 0, '${sha(1)}', 'lines', 'src/a.ts', 3, 3, 'issue', 1, 'human',
       NULL, NULL, NULL, 'Off by one', 'The loop stops one short.', ${quoted(patch)}, 'staged', NULL,
       NULL, '${at(4)}', '${at(4)}'),
      ('${id(22)}', '${id(1)}', 1, '${sha(1)}', 'file', 'README.md', NULL, NULL, 'suggestion', 0,
       'human', NULL, NULL, NULL, '', 'Mention the --verbose flag.', NULL, 'staged', NULL, NULL,
       '${at(4)}', '${at(5)}'),
      ('${id(23)}', '${id(1)}', 2, '${sha(1)}', 'change', NULL, NULL, NULL, 'praise', 0, 'human',
       NULL, NULL, NULL, 'Clear tests', '', NULL, 'withdrawn', NULL, NULL, '${at(4)}', '${at(6)}'),
      ('${id(24)}', '${id(1)}', 3, '${sha(1)}', 'lines', 'src/b.ts', 10, 14, 'todo', 1, 'human',
       NULL, NULL, NULL, 'Handle the empty list', '', NULL, 'staged', NULL, NULL, '${at(5)}',
       '${at(5)}'),
      ('${id(25)}', '${id(2)}', 0, '${sha(4)}', 'lines', 'src/a.ts', 3, 5, 'question', 0,
       'chat-answer', '${id(34)}', 0, NULL, 'Can n be zero?', 'An empty input skips the loop.',
       NULL, 'addressed', '${sha(2)}', 'agent', '${at(3)}', '${at(6)}'),
      ('${id(26)}', '${id(2)}', 1, '${sha(4)}', 'lines', 'src/c.ts', 1, 2, 'nitpick', 0,
       'chat-answer', '${id(32)}', NULL, 0, 'Name the constant', 'magic number', NULL,
       'addressed', '${sha(2)}', 'reviewer', '${at(3)}', '${at(6)}'),
      ('${id(27)}', '${id(2)}', 2, '${sha(2)}', 'lines', 'src/c.ts', 8, 8, 'smell', 0,
       'chat-answer', '${id(34)}', 1, NULL, '', 'This retries forever.', NULL, 'staged', NULL,
       NULL, '${at(6)}', '${at(6)}'),
      ('${id(28)}', '${id(2)}', 3, '${sha(2)}', 'change', NULL, NULL, NULL, 'chore', 1, 'human',
       NULL, NULL, NULL, 'Update the changelog', '', NULL, 'staged', NULL, NULL, '${at(7)}',
       '${at(7)}'),
      ('${id(29)}', '${id(3)}', 0, '${sha256(3)}', 'file', 'Makefile', NULL, NULL, 'thought', 0,
       'human', NULL, NULL, NULL, '', 'Could this target be phony?', NULL, 'staged', NULL, NULL,
       '${at(7)}', '${at(7)}'),
      ('${id(30)}', '${id(3)}', 1, '${sha256(3)}', 'lines', 'lib/ünï.c', 2, 4, 'note', 0, 'human',
       NULL, NULL, NULL, 'Mind the locale', '', NULL, 'withdrawn', NULL, NULL, '${at(7)}',
       '${at(8)}');

    INSERT INTO ura_verdict_choices (session_id, verdict, cleared_reason, head_sha, updated_at)
    VALUES
      ('${id(1)}', 'request-changes', NULL, '${sha(1)}', '${at(5)}'),
      ('${id(2)}', NULL, 'head-moved', NULL, '${at(6)}'),
      ('${id(3)}', NULL, 'blocking-staged', NULL, '${at(7)}');

    INSERT INTO ura_item_postings (item_id, target, session_id, url, head_sha, placement,
                                   posted_at)
    VALUES
      ('${id(25)}', 'github', '${id(2)}',
       'https://github.com/octo/beuve/pull/42#discussion_r1', '${sha(4)}', 'inline', '${at(5)}'),
      ('${id(26)}', 'github', '${id(2)}',
       'https://github.com/octo/beuve/pull/42#pullrequestreview-2', '${sha(4)}', 'body',
       '${at(5)}');
  `;
}

function chatRows(): string {
  const mention = { path: 'src/a.ts', side: 'head', startLine: 3, endLine: 5, sha: sha(4) };
  const note = {
    path: 'src/c.ts',
    startLine: 1,
    endLine: 2,
    label: 'nitpick',
    blocking: false,
    title: 'Name the constant',
    body: 'magic number',
  };
  const finding = {
    path: 'src/a.ts',
    startLine: 3,
    endLine: 5,
    severity: 'risk',
    category: 'edge-case',
    title: 'Can n be zero?',
    body: 'An empty input skips the loop.',
    confidence: 0.9,
    check: 'confirmed',
  };
  const review = {
    findings: [
      finding,
      {
        ...finding,
        startLine: 8,
        endLine: 8,
        severity: 'info',
        category: 'other',
        check: 'unchecked',
      },
    ],
    dropped: {
      unknownFile: 0,
      outsideDiff: 1,
      lowConfidence: 2,
      duplicate: 0,
      overLimit: 0,
      unconfirmed: 1,
    },
    pathScope: ['src/'],
    fileCount: 3,
    verification: 'verified',
  };
  const messages: readonly ChatSeed[] = [
    {
      id: 31,
      session: 2,
      head: sha(4),
      role: 'user',
      parts: [
        { kind: 'text', id: 'p1', text: 'Why does ' },
        { kind: 'mention', id: 'p2', mention },
        { kind: 'text', id: 'p3', text: " stop early? It's odd." },
      ],
      minute: 3,
    },
    {
      id: 32,
      session: 2,
      head: sha(4),
      role: 'assistant',
      parts: [
        { kind: 'reasoning', id: 'p1', state: 'done', summary: 'Reading the loop' },
        { kind: 'tool-call', id: 'p2', tool: 'Read', description: 'read src/a.ts', state: 'done' },
        { kind: 'text', id: 'p3', text: 'It stops at n - 1 [[src/a.ts:3-5]].' },
        { kind: 'proposal', id: 'p4', proposal: 0, note },
        { kind: 'dropped-proposal', id: 'p5', reason: 'outside-diff' },
      ],
      citations: [{ path: 'src/a.ts', startLine: 3, endLine: 5, side: 'head' }],
      minute: 3,
    },
    {
      id: 33,
      session: 2,
      head: sha(4),
      role: 'user',
      parts: [{ kind: 'text', id: 'p1', text: '/review src/' }],
      minute: 3,
    },
    {
      id: 34,
      session: 2,
      head: sha(4),
      role: 'assistant',
      kind: 'review',
      parts: [
        { kind: 'tool-call', id: 'p1', tool: 'Grep', description: 'search for n', state: 'failed' },
        { kind: 'finding', id: 'p2', finding: 0 },
        { kind: 'finding', id: 'p3', finding: 1 },
      ],
      review,
      minute: 3,
    },
    {
      id: 35,
      session: 2,
      head: sha(2),
      role: 'system-notice',
      parts: [{ kind: 'text', id: 'p1', text: 'The head moved to a new commit.' }],
      minute: 6,
    },
    {
      id: 36,
      session: 2,
      head: sha(2),
      role: 'summary',
      parts: [{ kind: 'text', id: 'p1', text: 'Earlier: the loop bound and the constant.' }],
      minute: 6,
    },
    {
      id: 37,
      session: 2,
      head: sha(2),
      role: 'assistant',
      status: 'error',
      parts: [
        { kind: 'text', id: 'p1', text: 'Looking' },
        { kind: 'error', id: 'p2', code: 'timeout' },
      ],
      minute: 7,
    },
    {
      id: 38,
      session: 1,
      head: sha(1),
      role: 'assistant',
      status: 'cancelled',
      parts: [
        { kind: 'tool-call', id: 'p1', tool: 'Read', description: 'read b.ts', state: 'stopped' },
      ],
      minute: 5,
    },
    {
      id: 39,
      session: 1,
      head: sha(1),
      role: 'assistant',
      kind: 'abstract',
      parts: [{ kind: 'text', id: 'p1', text: 'Adds notes to the review sheet.' }],
      minute: 5,
    },
    {
      id: 40,
      session: 1,
      head: sha(1),
      role: 'assistant',
      status: 'streaming',
      parts: [{ kind: 'reasoning', id: 'p1', state: 'running' }],
      minute: 6,
    },
    {
      id: 41,
      session: 1,
      head: sha(1),
      role: 'assistant',
      status: 'submitted',
      parts: [],
      minute: 6,
    },
    {
      id: 42,
      session: 1,
      head: sha(1),
      role: 'assistant',
      status: 'queued',
      kind: 'review',
      parts: [],
      minute: 6,
    },
  ];
  return `
    INSERT INTO chat_messages (id, session_id, head_sha, role, parts, citations, status, kind,
                               review, created_at)
    VALUES
      ${messages.map((message) => chatValuesOf(message)).join(',\n      ')};
  `;
}

/** A seeded chat message; `status` defaults to `done`, `kind` to `answer`. */
interface ChatSeed {
  readonly id: number;
  readonly session: number;
  readonly head: string;
  readonly role: string;
  readonly status?: string;
  readonly kind?: string;
  readonly parts: readonly object[];
  readonly citations?: readonly object[];
  readonly review?: object;
  readonly minute: number;
}

function chatValuesOf(message: ChatSeed): string {
  let review = 'NULL';
  if (message.review !== undefined) {
    review = quoted(JSON.stringify(message.review));
  }
  const values = [
    quoted(id(message.id)),
    quoted(id(message.session)),
    quoted(message.head),
    quoted(message.role),
    quoted(JSON.stringify(message.parts)),
    quoted(JSON.stringify(message.citations ?? [])),
    quoted(message.status ?? 'done'),
    quoted(message.kind ?? 'answer'),
    review,
    quoted(at(message.minute)),
  ];
  return `(${values.join(', ')})`;
}

function githubRows(): string {
  return `
    INSERT INTO github_pull_requests (host, owner, repo, number, title, body, author, state,
                                      is_draft, html_url, base_branch, base_sha, head_branch,
                                      head_sha, is_cross_repository, github_updated_at,
                                      fetched_at)
    VALUES
      ('github.com', 'octo', 'beuve', 42, 'Add notes', 'Closes #7.', 'mona', 'open', 0,
       'https://github.com/octo/beuve/pull/42', 'main', '${sha(9)}', 'feature/notes', '${sha(2)}',
       0, '2026-11-10T09:00:00Z', '${at(2)}'),
      ('github.example.com', 'team', 'tool', 7, 'Draft: fork fix', '', 'fork-user', 'merged', 1,
       'https://github.example.com/team/tool/pull/7', 'trunk', '${sha(8)}', 'fix', '${sha(7)}', 1,
       '2026-11-09T09:00:00Z', '${at(2)}');

    INSERT INTO github_branches (host, owner, repo, branch, default_branch, html_url, parent_owner,
                                 parent_repo, source_owner, source_repo, head_sha, state,
                                 pull_owner, pull_repo, pull_number, fetched_at)
    VALUES
      ('github.com', 'octo', 'other', 'topic/fix', 'main',
       'https://github.com/octo/other/tree/topic/fix', 'upstream', 'other', 'upstream', 'other',
       '${sha256(3)}', 'present', 'upstream', 'other', 12, '${at(3)}'),
      ('github.com', 'octo', 'other', 'old', 'main', 'https://github.com/octo/other/tree/old',
       NULL, NULL, NULL, NULL, '${sha(6)}', 'gone', NULL, NULL, NULL, '${at(3)}');
  `;
}

function reviewEditRows(): string {
  return `
    INSERT INTO review_edit_branches (session_id, repo_path, branch, base_sha, created_at)
    VALUES ('${id(1)}', '/Users/reviewer/src/café app', 'review/feature-notes', '${sha(1)}',
            '${at(5)}');

    INSERT INTO review_edit_suggestions (session_id, head_sha, target, item_id, fingerprint)
    VALUES ('${id(1)}', '${sha(1)}', 'lines:src/a.ts:3-3', '${id(21)}', '${sha256(4)}');
  `;
}

function setupRows(): string {
  return `
    INSERT INTO setup_commands (repository, command, updated_at)
    VALUES ('github.com/octo/beuve', 'npm ci && npm run build', '${at(2)}');

    INSERT INTO setup_runs (session_id, head_sha, checkout, finished_at)
    VALUES ('${id(2)}', '${sha(2)}', '/Users/reviewer/Library/beuve/checkouts/${sha(2)}',
            '${at(4)}');
  `;
}

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function sha(n: number): string {
  return String(n).repeat(40);
}

function sha256(n: number): string {
  return String(n).repeat(64);
}

/** The `n`th minute past 12:00 on the fixture's day, as the app stores times. */
function at(n: number): string {
  return `2026-11-11T12:${String(n).padStart(2, '0')}:00.000Z`;
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
