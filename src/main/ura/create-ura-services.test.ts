import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IpcResult, UraItemView } from '#contract/ipc-contract.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import type {
  AgentInsight,
  AgentInsightId,
  CommitSha,
  ReviewRunId,
  SessionId,
} from '#internal/review/agent-insight.ts';
import { insertReviewRun } from '#internal/review/insert-review-run.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';

const insightId = '33333333-3333-4333-8333-333333333333';

describe('URA services (integration: SQLite + git, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices;
  let sessionId: string;
  let changes: string[];

  beforeEach(async () => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    services = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps: steppingDeps(),
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
    });
    changes = [];
    services.ura.onChanged((id) => {
      changes.push(id);
    });
    featureBranch(repo);
    sessionId = value(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    ).id;
  });

  afterEach(async () => {
    await services.dispose();
    db.close();
    repo.cleanup();
  });

  const note = async (startLine: number, endLine: number, title: string): Promise<UraItemView> =>
    value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'lines', path: 'src/app.ts', startLine, endLine },
        severity: 'issue',
        title,
        body: 'Body',
      }),
    );

  it('stages a chat answer as a note that remembers its message', async () => {
    const messageId = '00000000-0000-4000-8000-0000000000aa';
    const staged = value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'question',
        title: 'From the chat',
        body: 'An answer',
        origin: { kind: 'chat-answer', messageId },
      }),
    );
    expect(staged).toMatchObject({
      origin: { kind: 'chat-answer', messageId },
      status: { kind: 'staged' },
    });
    expect(value(await services.ura.list({ sessionId })).items.map((item) => item.origin)).toEqual([
      { kind: 'chat-answer', messageId },
    ]);
  });

  it('creates, lists, edits, withdraws, restages and reorders human notes', async () => {
    const head = repo.git('rev-parse', 'feature');
    const first = await note(2, 3, 'Name the constant');
    expect(first).toMatchObject({
      sessionId,
      headSha: head,
      anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 3 },
      placement: { kind: 'current', anchor: { startLine: 2, endLine: 3 } },
      origin: { kind: 'human' },
      status: { kind: 'staged' },
    });
    const second = value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'blocker',
        title: '  Missing tests  ',
        body: '',
      }),
    );
    expect(second.title).toBe('Missing tests');
    expect(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'change' },
        severity: 'nit',
        title: 'Patch on the whole change',
        body: '',
        suggestedPatch: '@@ -1 +1 @@\n-a\n+b\n',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });

    const listed = value(await services.ura.list({ sessionId }));
    expect(listed.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(listed.derivedVerdict).toBe('request-changes');

    const patch = '@@ -2 +2 @@\n-const answer = 1;\n+const answer = 2;\n';
    const edited = value(
      await services.ura.update({ itemId: first.id, severity: 'nit', suggestedPatch: patch }),
    );
    expect(edited).toMatchObject({ severity: 'nit', title: 'Name the constant' });
    expect(edited.suggestedPatch).toBe(`--- a/src/app.ts\n+++ b/src/app.ts\n${patch}`);
    expect(
      await services.ura.update({ itemId: first.id, suggestedPatch: '@@ -9 +9 @@\n-x\n+y\n' }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(
      value(await services.ura.update({ itemId: first.id, suggestedPatch: '' })).suggestedPatch,
    ).toBeUndefined();

    expect(
      value(await services.ura.transition({ itemId: second.id, to: 'withdrawn' })).status,
    ).toEqual({ kind: 'withdrawn' });
    expect(value(await services.ura.list({ sessionId })).derivedVerdict).toBe('approve');
    expect(await services.ura.transition({ itemId: second.id, to: 'addressed' })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    value(await services.ura.transition({ itemId: second.id, to: 'staged' }));
    expect(await services.ura.transition({ itemId: first.id, to: 'addressed' })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });

    expect(services.ura.reorder({ sessionId, itemIds: [first.id] })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });
    value(services.ura.reorder({ sessionId, itemIds: [second.id, first.id] }));
    expect(value(await services.ura.list({ sessionId })).items.map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(changes.length).toBeGreaterThanOrEqual(7);
    expect(new Set(changes)).toEqual(new Set([sessionId]));
    expect(await services.ura.update({ itemId: insightId, title: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  it('re-anchors notes written at an older head, and flags replaced lines as outdated', async () => {
    const shifted = await note(5, 6, 'Below the edit');
    const replaced = await note(2, 2, 'On the edited line');
    const fileNote = value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'question',
        title: 'Why a new file?',
        body: '',
      }),
    );
    const oldHead = repo.git('rev-parse', 'feature');

    repo.git('switch', '--quiet', 'feature');
    repo.write(
      'src/app.ts',
      lines(['// header', '// more', ...appLines.with(1, 'const answer = 42;')]),
    );
    const newHead = repo.commit('author edits above');
    repo.git('switch', '--quiet', 'main');

    const listed = value(await services.ura.list({ sessionId }));
    expect(listed.headSha).toBe(newHead);
    const byId = new Map(listed.items.map((item) => [item.id, item]));
    expect(byId.get(shifted.id)).toMatchObject({
      headSha: oldHead,
      anchor: { startLine: 5, endLine: 6 },
      placement: { kind: 'current', anchor: { path: 'src/app.ts', startLine: 7, endLine: 8 } },
    });
    expect(byId.get(replaced.id)?.placement).toEqual({ kind: 'outdated', reason: 'lines-changed' });
    expect(byId.get(fileNote.id)?.placement).toMatchObject({ kind: 'current' });
    expect(changes).toContain(sessionId);

    value(await services.ura.transition({ itemId: replaced.id, to: 'addressed' }));
    const markdown = value(await services.ura.export({ sessionId, target: 'markdown' }));
    expect(markdown).toMatchObject({ headSha: newHead, itemCount: 2, outdatedCount: 0 });
    expect(markdown.text).toContain('`src/app.ts:7-8`');

    repo.git('switch', '--quiet', 'feature');
    repo.git('rm', '--quiet', 'src/app.ts');
    repo.commit('delete the file');
    repo.git('switch', '--quiet', 'main');
    const deleted = value(await services.ura.list({ sessionId }));
    expect(deleted.items.find((item) => item.id === shifted.id)?.placement).toEqual({
      kind: 'outdated',
      reason: 'file-deleted',
    });
  });

  it('promotes an insight atomically and idempotently, mirroring withdraw and restage', async () => {
    const head = repo.git('rev-parse', 'feature');
    storeInsights(db, sessionId, head, [
      insight(insightId, 'Unchecked answer'),
      insight('44444444-4444-4444-8444-444444444444', 'Tab\tin the title'),
    ]);

    const promoted = value(await services.ura.promoteInsight({ insightId }));
    expect(promoted.created).toBe(true);
    expect(promoted.item).toMatchObject({
      severity: 'issue',
      origin: { kind: 'agent-insight', insightId },
      anchor: { kind: 'lines', path: 'src/app.ts', startLine: 2, endLine: 2 },
      title: 'Unchecked answer',
    });
    expect(await insightStatus(services, sessionId, insightId)).toBe('promoted');
    const again = value(await services.ura.promoteInsight({ insightId }));
    expect(again).toEqual({ item: promoted.item, created: false });
    expect(value(await services.ura.list({ sessionId })).items).toHaveLength(1);

    value(await services.ura.transition({ itemId: promoted.item.id, to: 'withdrawn' }));
    expect(await insightStatus(services, sessionId, insightId)).toBe('pending');
    const restaged = value(await services.ura.promoteInsight({ insightId, severity: 'blocker' }));
    expect(restaged).toMatchObject({
      created: false,
      item: { id: promoted.item.id, status: { kind: 'staged' }, severity: 'issue' },
    });
    expect(await insightStatus(services, sessionId, insightId)).toBe('promoted');

    const invalid = '44444444-4444-4444-8444-444444444444';
    expect(await services.ura.promoteInsight({ insightId: invalid })).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    expect(await insightStatus(services, sessionId, invalid)).toBe('pending');
    expect(value(await services.ura.list({ sessionId })).items).toHaveLength(1);
    expect(
      await services.ura.promoteInsight({ insightId: '55555555-5555-4555-8555-555555555555' }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('stages an ImpactGate finding once, looked up from its own report', async () => {
    const finding = value(
      await services.ura.stageImpactFinding({
        sessionId,
        path: 'src/complex.ts',
        functionName: 'decide',
      }),
    );
    expect(finding).toMatchObject({
      created: true,
      item: {
        severity: 'issue',
        origin: { kind: 'impact-finding', metric: 'cognitive-complexity', functionName: 'decide' },
        anchor: { kind: 'lines', path: 'src/complex.ts', startLine: 1 },
      },
    });
    expect(
      value(
        await services.ura.stageImpactFinding({
          sessionId,
          path: 'src/complex.ts',
          functionName: 'decide',
        }),
      ),
    ).toEqual({ item: finding.item, created: false });
    expect(
      await services.ura.stageImpactFinding({ sessionId, path: 'src/app.ts', functionName: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('exports every target and refuses to approve over a blocker', async () => {
    const head = repo.git('rev-parse', 'feature');
    await note(2, 2, 'Prefer <const>');
    const blocker = value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'blocker',
        title: 'Not wired',
        body: 'Nothing calls `answer`.',
      }),
    );

    const json = value(await services.ura.export({ sessionId, target: 'agent-json' }));
    expect(json).toMatchObject({
      mediaType: 'application/json',
      verdict: 'request-changes',
      verdictSource: 'derived',
      itemCount: 2,
    });
    expect(JSON.parse(json.text)).toMatchObject({
      schema: 'beuve.ura/1',
      change: { scope: 'full', headSha: head, repository: { kind: 'local', headRef: 'feature' } },
      items: [{ title: 'Prefer <const>' }, { severity: 'blocker' }],
    });
    const xml = value(await services.ura.export({ sessionId, target: 'agent-xml' }));
    expect(xml.mediaType).toBe('application/xml');
    expect(xml.text).toContain('<title>Prefer &lt;const&gt;</title>');
    const github = value(
      await services.ura.export({ sessionId, target: 'github', verdict: 'comment' }),
    );
    expect(github).toMatchObject({ verdict: 'comment', verdictSource: 'chosen' });
    expect(JSON.parse(github.text)).toMatchObject({
      commit_id: head,
      event: 'COMMENT',
      comments: [{ path: 'src/app.ts', line: 2, side: 'RIGHT' }],
    });
    const markdown = value(await services.ura.export({ sessionId, target: 'markdown' }));
    expect(markdown.text).toContain('# Review of `feature` into `main`');
    expect(
      await services.ura.export({ sessionId, target: 'github', verdict: 'approve' }),
    ).toMatchObject({ ok: false, error: { code: 'refused' } });

    value(await services.ura.transition({ itemId: blocker.id, to: 'withdrawn' }));
    expect(
      value(await services.ura.export({ sessionId, target: 'github', verdict: 'approve' })),
    ).toMatchObject({ verdict: 'approve', itemCount: 1 });
  });

  it('answers beuve_read_human_review with the agent JSON and its XML, defaulting the session', async () => {
    await note(5, 6, 'Below the edit');
    const read = await services.mcpTools.readHumanReview({});
    if (!read.ok) {
      throw new Error(read.error);
    }
    expect(read.value.structured).toMatchObject({
      schema: 'beuve.ura/1',
      verdict: 'comment',
      counts: { issue: 1 },
      items: [{ anchor: { kind: 'lines', path: 'src/app.ts', startLine: 5, endLine: 6 } }],
    });
    expect(read.value.text).toContain('<beuve-review schema="beuve.ura/1" verdict="comment"');
    expect(await services.mcpTools.readHumanReview({ sessionId: 'nope' })).toMatchObject({
      ok: false,
    });
  });
  it('persists the reviewer-chosen verdict for exports and beuve_read_human_review', async () => {
    await note(2, 2, 'Prefer const');
    const read = async (): Promise<{ verdict: unknown; text: string }> => {
      const review = await services.mcpTools.readHumanReview({});
      if (!review.ok) {
        throw new Error(review.error);
      }
      return { verdict: review.value.structured['verdict'], text: review.value.text };
    };
    const initial = await read();
    expect(initial.verdict).toBe('comment');

    expect(value(services.ura.setVerdict({ sessionId, verdict: 'approve' }))).toEqual({
      sessionId,
      derivedVerdict: 'comment',
      chosenVerdict: 'approve',
    });
    expect(changes.at(-1)).toBe(sessionId);
    expect(value(await services.ura.list({ sessionId }))).toMatchObject({
      derivedVerdict: 'comment',
      chosenVerdict: 'approve',
    });
    const approved = await read();
    expect(approved.verdict).toBe('approve');
    expect(approved.text).toContain('verdict="approve"');
    expect(value(await services.ura.export({ sessionId, target: 'github' }))).toMatchObject({
      verdict: 'approve',
      verdictSource: 'chosen',
      derivedVerdict: 'comment',
    });
    expect(
      value(await services.ura.export({ sessionId, target: 'github', verdict: 'request-changes' })),
    ).toMatchObject({ verdict: 'request-changes' });
    expect(value(await services.ura.list({ sessionId })).chosenVerdict).toBe('approve');

    const stored = db.prepare('SELECT verdict FROM ura_verdict_choices;').all();
    expect(stored).toEqual([{ verdict: 'approve' }]);

    expect(value(services.ura.setVerdict({ sessionId, verdict: 'comment' }))).toEqual({
      sessionId,
      derivedVerdict: 'comment',
    });
    expect(db.prepare('SELECT count(*) AS n FROM ura_verdict_choices;').get()).toEqual({ n: 0 });
    const restored = await read();
    expect(restored.verdict).toBe('comment');
    expect(
      services.ura.setVerdict({
        sessionId: '99999999-9999-4999-8999-999999999999',
        verdict: 'comment',
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });

  it('clears an approval when a blocker is staged, says so, and refuses a new one', async () => {
    await note(2, 2, 'Prefer const');
    value(services.ura.setVerdict({ sessionId, verdict: 'approve' }));
    const blocker = value(
      await services.ura.create({
        sessionId,
        anchor: { kind: 'file', path: 'src/app.ts' },
        severity: 'blocker',
        title: 'Not wired',
        body: '',
      }),
    );

    const listed = value(await services.ura.list({ sessionId }));
    expect(listed.chosenVerdict).toBeUndefined();
    expect(listed.derivedVerdict).toBe('request-changes');
    expect(listed.verdictNotice).toContain('Approve verdict was cleared');
    const read = await services.mcpTools.readHumanReview({});
    expect(read.ok && read.value.structured['verdict']).toBe('request-changes');
    expect(services.ura.setVerdict({ sessionId, verdict: 'approve' })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });

    value(await services.ura.transition({ itemId: blocker.id, to: 'withdrawn' }));
    expect(value(await services.ura.list({ sessionId })).verdictNotice).toContain('cleared');
    value(services.ura.setVerdict({ sessionId, verdict: 'approve' }));
    expect(value(await services.ura.list({ sessionId }))).toMatchObject({
      chosenVerdict: 'approve',
    });
    expect(value(await services.ura.list({ sessionId })).verdictNotice).toBeUndefined();
  });
});

const appLines = [
  'export function answer(): number {',
  '  const answer = 1;',
  '  return answer;',
  '}',
  'export function other(): number {',
  '  return 2;',
  '}',
];

/** Mirrors `decide`'s nesting so ImpactGate flags it (cognitive complexity over 15). */
const complexLines = [
  'export function decide(a: number, b: number, c: readonly number[]): number {',
  '  if (a > 0) {',
  '    if (b > 0) {',
  '      for (const x of c) {',
  '        if (x > a) {',
  '          if (x > b && a !== b) {',
  '            return x;',
  '          } else if (x < 0) {',
  '            continue;',
  '          }',
  '        } else {',
  '          while (x > 10) {',
  '            break;',
  '          }',
  '        }',
  '      }',
  '    }',
  '  }',
  '  return 0;',
  '}',
];

/** main: nothing much; feature adds `src/app.ts` and a complex `src/complex.ts`. */
function featureBranch(repo: TestRepository): void {
  repo.write('README.md', lines(['# test']));
  repo.commit('base');
  repo.git('switch', '--quiet', '--create', 'feature');
  repo.write('src/app.ts', lines(appLines));
  repo.write('src/complex.ts', lines(complexLines));
  repo.commit('add app');
  repo.git('switch', '--quiet', 'main');
}

function insight(id: string, title: string): AgentInsight {
  return {
    id: id as AgentInsightId,
    runId: '22222222-2222-4222-8222-222222222222' as ReviewRunId,
    sessionId: '' as SessionId,
    headSha: '' as CommitSha,
    path: 'src/app.ts',
    side: 'head',
    lineStart: 2,
    lineEnd: 2,
    severity: 'warning',
    category: 'edge-case',
    title,
    body: 'Check it.',
    confidence: 0.8,
    status: 'pending',
    model: 'fake-model-1',
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

function storeInsights(
  db: DatabaseSync,
  sessionId: string,
  head: string,
  insights: readonly AgentInsight[],
): void {
  const owned = insights.map((entry) => ({
    ...entry,
    sessionId: sessionId as SessionId,
    headSha: head as CommitSha,
  }));
  const stored = insertReviewRun(
    db,
    {
      id: '22222222-2222-4222-8222-222222222222' as ReviewRunId,
      sessionId: sessionId as SessionId,
      scope: 'full',
      pathScope: [],
      baseSha: head as CommitSha,
      headSha: head as CommitSha,
      fromHeadSha: undefined,
      model: 'fake-model-1',
      insightCount: owned.length,
      droppedCount: 0,
      createdAt: '2026-10-28T12:00:00.000Z',
    },
    owned,
  );
  if (!stored.ok) {
    throw new Error(stored.error.kind);
  }
}

async function insightStatus(
  services: MainServices,
  sessionId: string,
  id: string,
): Promise<string | undefined> {
  const listed = value(await services.review.listInsights({ sessionId }));
  return listed.insights.find((entry) => entry.id === id)?.status;
}

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function lines(content: readonly string[]): string {
  return content.map((line) => `${line}\n`).join('');
}

function steppingDeps(): SessionDeps {
  let tick = 0;
  let id = 0;
  return {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, 0, tick++)),
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}
