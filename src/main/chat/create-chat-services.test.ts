import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ChatDeltaView,
  ChatMessageUpdatedView,
  ChatMessageView,
  IpcResult,
} from '#contract/ipc-contract.ts';
import { appendChatMessage } from '#internal/chat/append-chat-message.ts';
import type { ChatMessageId, CommitSha, SessionId } from '#internal/chat/chat-message.ts';
import { createTestRepository } from '#internal/git/testing/create-test-repository.ts';
import type { TestRepository } from '#internal/git/testing/test-repository.ts';
import { writeFakeClaude } from '#internal/llm/testing/write-fake-claude.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';
import { createSessionWorktrees } from '../worktrees/create-session-worktrees.ts';
import type { ClaudeCodeSettings } from './claude-code-settings.ts';
import { createChatServices } from './create-chat-services.ts';

const answerChunks = ['It adds ', '[[feature.rs:1-2]] and ', 'ignores [[ghost.rs:4]].'];
const answerText = 'It adds [[feature.rs:1-2]] and ignores `ghost.rs:4-4`.';

/** The chat through `createMainServices`, a temporary repository and the fake `claude` (ADR 0031). */
describe('createChatServices (integration: SQLite + git + fake claude, no Electron)', () => {
  let repo: TestRepository;
  let db: DatabaseSync;
  let services: MainServices | undefined;
  let script: string;
  let deps: SessionDeps;
  let deltas: ChatDeltaView[];
  let updates: ChatMessageView[];

  beforeEach(() => {
    repo = createTestRepository();
    db = openAppDatabase(':memory:');
    script = writeFakeClaude(repo.scratch());
    deps = countingDeps();
    deltas = [];
    updates = [];
    repo.write('app.rs', 'fn main() {\n  run();\n}\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('feature.rs', 'pub fn feature() -> u8 {\n  1\n}\n');
    repo.commit('add feature');
    repo.git('switch', '--quiet', 'main');
  });

  afterEach(async () => {
    await services?.dispose();
    services = undefined;
    db.close();
    repo.cleanup();
  });

  const start = async (claude: ClaudeCodeSettings): Promise<{ sessionId: string }> => {
    services = createMainServices({
      db,
      logger: createLogger('test', { sink: (): void => undefined }),
      deps,
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
      claude: { killGrace: Temporal.Duration.from({ milliseconds: 200 }), ...claude },
    });
    services.chat.onDelta((event: ChatDeltaView) => {
      deltas.push(event);
    });
    services.chat.onMessageUpdated((event: ChatMessageUpdatedView) => {
      updates.push(event.message);
    });
    const { id } = value(
      await services.sessions.createLocal({
        repoPath: repo.directory,
        baseRef: 'main',
        headRef: 'feature',
      }),
    );
    return { sessionId: id };
  };

  const scripted = (
    chunks: string[],
    delayMs = 0,
    name = 'chat',
    structured: object = {},
  ): ClaudeCodeSettings => {
    const file = path.join(repo.scratch(), `${name}.json`);
    writeFileSync(file, JSON.stringify({ preamble: 'Looking.', chunks, delayMs, ...structured }));
    return { command: process.execPath, leadingArgs: [script, 'chat', file] };
  };

  const settled = async (messageId: string): Promise<ChatMessageView> => {
    for (let waited = 0; waited < 15_000; waited += 20) {
      const update = updates.find(
        (message) =>
          message.id === messageId && message.status !== 'queued' && message.status !== 'streaming',
      );
      if (update !== undefined) {
        return update;
      }
      await delay(20);
    }
    throw new Error(`answer ${messageId} did not finish`);
  };

  it('answers in the background: deltas, then a stored answer with validated citations', async () => {
    const claude = scripted(answerChunks, 20);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;

    const asked = value(
      await chat.ask({ sessionId, question: ' What does it add? ', focus: { path: 'feature.rs' } }),
    );
    expect(asked.question).toMatchObject({
      role: 'user',
      content: 'What does it add?',
      status: 'complete',
    });
    expect(asked.answer).toMatchObject({ role: 'assistant', status: 'streaming', content: '' });
    expect(updates).toEqual([]);

    const done = await settled(asked.answer.id);
    expect(done).toMatchObject({
      status: 'complete',
      content: answerText,
      citations: [{ path: 'feature.rs', startLine: 1, endLine: 2 }],
    });
    expect(deltas.map(({ kind, text }) => [kind, text])).toEqual([
      ['append', 'Looking.'],
      ['reset', ''],
      ['append', 'It adds '],
      ['append', '[[feature.rs:1-2]] and '],
      ['append', 'ignores [[ghost.rs:4]].'],
    ]);
    expect(deltas.every(({ messageId }) => messageId === asked.answer.id)).toBe(true);

    const listed = value(chat.list({ sessionId }));
    expect(listed.messages.map(({ id, role, status }) => [id, role, status])).toEqual([
      [asked.question.id, 'user', 'complete'],
      [asked.answer.id, 'assistant', 'complete'],
    ]);
    expect(listed.messages[1]).toEqual(done);

    const [call] = calls(claude);
    expect(call?.cwd).toContain('worktrees');
    expect(call?.args).toContain('--include-partial-messages');
    expect(call?.stdin).toContain('What does it add?');
    expect(call?.stdin).toContain('feature.rs');
  });

  it('puts the earlier turns into the next prompt', async () => {
    const claude = scripted(['First answer about the feature.']);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const first = value(await chat.ask({ sessionId, question: 'First question?' }));
    await settled(first.answer.id);
    const second = value(await chat.ask({ sessionId, question: 'Second question?' }));
    await settled(second.answer.id);
    const [firstCall, secondCall] = calls(claude);
    expect(firstCall?.stdin).not.toContain('First answer about the feature.');
    expect(secondCall?.stdin).toContain('First question?');
    expect(secondCall?.stdin).toContain('First answer about the feature.');
    expect(secondCall?.stdin.indexOf('Second question?')).toBeGreaterThan(
      secondCall?.stdin.indexOf('First answer about the feature.') ?? Infinity,
    );
  });

  it('queues questions asked while one streams, runs them in order and cancels one at a time', async () => {
    const claude = scripted(['a', 'b', 'c'], 120);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const first = value(await chat.ask({ sessionId, question: 'First?' }));
    const second = value(await chat.ask({ sessionId, question: 'Second?' }));
    const third = value(await chat.ask({ sessionId, question: 'Third?' }));
    const fourth = value(await chat.ask({ sessionId, question: 'Fourth?' }));
    expect(first.answer.status).toBe('streaming');
    expect([second, third, fourth].map(({ answer }) => answer.status)).toEqual([
      'queued',
      'queued',
      'queued',
    ]);
    expect(value(chat.list({ sessionId })).messages.map(({ status }) => status)).toEqual([
      'complete',
      'streaming',
      'complete',
      'queued',
      'complete',
      'queued',
      'complete',
      'queued',
    ]);

    await waitUntil(
      () => deltas.some(({ messageId, text }) => messageId === first.answer.id && text === 'a'),
      'the first answer to stream',
    );
    expect(value(chat.cancel({ messageId: first.answer.id }))).toEqual({ cancelled: true });
    expect(value(chat.cancel({ messageId: third.answer.id }))).toEqual({ cancelled: true });
    expect(await settled(first.answer.id)).toMatchObject({ status: 'cancelled', content: 'a' });
    expect(await settled(third.answer.id)).toMatchObject({ status: 'cancelled', content: '' });
    expect(await settled(fourth.answer.id)).toMatchObject({ status: 'complete', content: 'abc' });
    const order = updates
      .filter(({ status }) => status === 'streaming' || status === 'complete')
      .map(({ id, status }) => [id, status]);
    expect(order).toEqual([
      [second.answer.id, 'streaming'],
      [second.answer.id, 'complete'],
      [fourth.answer.id, 'streaming'],
      [fourth.answer.id, 'complete'],
    ]);
    const asked = calls(claude).map(({ stdin }) =>
      ['First?', 'Second?', 'Third?', 'Fourth?'].findLast((question) => stdin.includes(question)),
    );
    expect(asked).toEqual(['First?', 'Second?', 'Fourth?']);
    expect(calls(claude)[2]?.stdin).toContain('abc');
  });

  it('cancels the running answer and the queued requests when the session head moves', async () => {
    const claude = scripted(['a', 'b', 'c'], 120);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const running = value(await chat.ask({ sessionId, question: 'Running?' }));
    const waiting = value(await chat.ask({ sessionId, question: 'Waiting?' }));
    const compaction = value(
      await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
    );
    expect([running, waiting, compaction].map(({ answer }) => answer.status)).toEqual([
      'streaming',
      'queued',
      'queued',
    ]);
    await waitUntil(
      () => deltas.some(({ messageId, text }) => messageId === running.answer.id && text === 'a'),
      'the running answer to stream',
    );

    repo.git('switch', '--quiet', 'feature');
    repo.write('more.rs', 'pub fn more() {}\n');
    repo.commit('push');
    repo.git('switch', '--quiet', 'main');
    value(await must(services).sessions.getReview({ sessionId }));

    expect(await settled(running.answer.id)).toMatchObject({ status: 'cancelled' });
    expect(await settled(waiting.answer.id)).toMatchObject({ status: 'cancelled', content: '' });
    expect(await settled(compaction.answer.id)).toMatchObject({ status: 'cancelled', content: '' });
    const after = value(await chat.ask({ sessionId, question: 'After the push?' }));
    expect(await settled(after.answer.id)).toMatchObject({ status: 'complete', content: 'abc' });
    expect(calls(claude)).toHaveLength(2);
  });

  it('queues requests made at the same moment in the order they were made', async () => {
    const claude = scripted(['x'], 200);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const review = value(await must(services).sessions.getReview({ sessionId }));
    const mention = { path: 'feature.rs', side: 'head', sha: review.headSha } as const;
    const asked = await Promise.all([
      chat.ask({ sessionId, question: 'One?' }),
      chat.ask({ sessionId, question: 'Two [[@1]]?', mentions: [mention] }),
      chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
      chat.ask({ sessionId, question: 'Four?' }),
    ]);
    const questions = value(chat.list({ sessionId }))
      .messages.filter(({ role }) => role === 'user')
      .map(({ content }) => content);
    expect(questions).toEqual(['One?', 'Two [[@1]]?', '/summarize', 'Four?']);
    expect(asked.map((result) => value(result).answer.status)).toEqual([
      'streaming',
      'queued',
      'queued',
      'queued',
    ]);
    value(chat.clear({ sessionId }));
  });

  it('bounds the queue, and /clear stops the running answer and empties the queue', async () => {
    const claude = scripted(['a', 'b', 'c'], 300);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const running = value(await chat.ask({ sessionId, question: 'Running?' }));
    const queued = [];
    for (let index = 0; index < 10; index += 1) {
      const asked = await chat.ask({ sessionId, question: `Queued ${String(index)}?` });
      queued.push(value(asked));
    }
    expect(await chat.ask({ sessionId, question: 'One too many?' })).toMatchObject({
      ok: false,
      error: { code: 'refused', message: expect.stringContaining('already waiting') as string },
    });
    expect(value(chat.clear({ sessionId, queuedOnly: true }))).toEqual({ removed: 20 });
    expect(value(chat.list({ sessionId })).messages.map(({ id }) => id)).toEqual([
      running.question.id,
      running.answer.id,
    ]);
    const later = value(await chat.ask({ sessionId, question: 'Later?' }));
    expect(later.answer.status).toBe('queued');

    expect(value(chat.clear({ sessionId }))).toEqual({ removed: 4 });
    await delay(400);
    expect(calls(claude).length).toBeLessThanOrEqual(1);
    expect(updates.filter(({ id }) => id === later.answer.id)).toEqual([]);
    expect(value(chat.list({ sessionId })).messages).toEqual([]);
    expect(queued).toHaveLength(10);
  });

  it('answers /review with verified, structured findings, stages one, and reuses the answer', async () => {
    const claude = scripted(['Follow-up answer.'], 0, 'review', {
      findings: [
        modelFinding('feature.rs', 2, 'warning', 'The constant hides a missing computation'),
        modelFinding('feature.rs', 3, 'risk', 'The closing brace swallows a return'),
        modelFinding('feature.rs', 40, 'info', 'Outside the diff'),
        modelFinding('missing.rs', 1, 'info', 'Not in the diff'),
      ],
      verdicts: [
        { finding: 1, verdict: 'confirmed', reason: 'Line 2 returns a constant.' },
        { finding: 2, verdict: 'refuted', reason: 'Line 3 is only a brace.' },
      ],
    });
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const asked = value(
      await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
    );
    expect(asked.answer).toMatchObject({ answerKind: 'review', status: 'streaming' });
    const reviewed = await settled(asked.answer.id);
    expect(reviewed).toMatchObject({
      status: 'complete',
      answerKind: 'review',
      citations: [{ path: 'feature.rs', startLine: 2, endLine: 2 }],
      review: {
        findings: [
          {
            path: 'feature.rs',
            startLine: 2,
            endLine: 2,
            severity: 'warning',
            category: 'edge-case',
            title: 'The constant hides a missing computation',
            confidence: 0.8,
            check: 'confirmed',
          },
        ],
        dropped: { unknownFile: 1, outsideDiff: 1, unconfirmed: 1 },
        pathScope: [],
        fileCount: 1,
        verification: 'verified',
      },
    });
    expect(reviewed.content).toContain('1 dropped as unconfirmed');
    expect(reviewed.content).toContain('[[feature.rs:2-2]]');
    expect(deltas.filter(({ kind }) => kind === 'progress').map(({ text }) => text)).toContain(
      'Checking 2 findings against the code',
    );

    const [find, verify] = calls(claude);
    expect(find?.args.some((arg) => arg.startsWith('--json-schema='))).toBe(true);
    expect(find?.stdin).toContain('## Task');
    expect(find?.stdin).toContain('Review the whole change');
    expect(find?.stdin).toContain('## Diff');
    expect(verify?.args).toContain('--effort=low');
    expect(verify?.stdin).toContain('# Findings to check');
    expect(verify?.stdin).toContain('## Finding 2: feature.rs:3-3 (risk, edge-case)');
    expect(verify?.stdin).not.toContain('## Diff');

    const staged = value(
      await must(services).ura.stageReviewFinding({ messageId: asked.answer.id, finding: 0 }),
    );
    expect(staged).toMatchObject({
      created: true,
      item: {
        severity: 'issue',
        origin: { kind: 'chat-answer', messageId: asked.answer.id, finding: 0 },
        anchor: { kind: 'lines', path: 'feature.rs', startLine: 2, endLine: 2 },
        title: 'The constant hides a missing computation',
      },
    });

    const again = value(
      await chat.ask({ sessionId, question: '/review', command: { kind: 'review' } }),
    );
    expect(await settled(again.answer.id)).toMatchObject({
      status: 'complete',
      review: { reusedFrom: asked.answer.id, findings: [{ check: 'confirmed' }] },
    });
    expect(calls(claude)).toHaveLength(2);

    const fresh = value(
      await chat.ask({
        sessionId,
        question: '/review --fresh --no-verify feature.rs',
        command: { kind: 'review', fresh: true, verify: false, pathPrefixes: ['feature.rs'] },
      }),
    );
    expect(await settled(fresh.answer.id)).toMatchObject({
      status: 'complete',
      review: {
        pathScope: ['feature.rs'],
        verification: 'skipped',
        findings: [{ check: 'unchecked' }, { check: 'unchecked' }],
      },
    });
    expect(calls(claude)).toHaveLength(3);
    expect(calls(claude)[2]?.stdin).toContain('only the files at or under feature.rs');

    const nothing = value(
      await chat.ask({
        sessionId,
        question: '/review docs',
        command: { kind: 'review', pathPrefixes: ['docs'] },
      }),
    );
    expect(await settled(nothing.answer.id)).toMatchObject({
      status: 'failed',
      errorCode: 'nothing-to-review',
    });

    const followUp = value(await chat.ask({ sessionId, question: 'Is finding 1 real?' }));
    await settled(followUp.answer.id);
    expect(calls(claude).at(-1)?.stdin).toContain('The constant hides a missing computation');
  });

  it('explains a missing Claude Code and a logged-out one', async () => {
    const home = repo.scratch();
    const { sessionId } = await start({
      env: { BEUVE_CLAUDE_PATH: path.join(home, 'no-claude'), PATH: '' },
      homeDirectory: home,
    });
    const chat = must(services).chat;
    const missing = value(await chat.ask({ sessionId, question: 'Anyone there?' }));
    expect(await settled(missing.answer.id)).toMatchObject({
      status: 'failed',
      errorCode: 'not-installed',
      errorMessage: expect.stringContaining('BEUVE_CLAUDE_PATH') as string,
    });
    expect(value(chat.list({ sessionId })).messages[1]).toMatchObject({
      status: 'failed',
      errorCode: 'not-installed',
    });
    await services?.dispose();

    updates = [];
    const loggedOut = await start({
      command: process.execPath,
      leadingArgs: [script, 'not-logged-in'],
    });
    const second = value(
      await must(services).chat.ask({ sessionId: loggedOut.sessionId, question: 'Hello?' }),
    );
    expect(await settled(second.answer.id)).toMatchObject({
      status: 'failed',
      errorCode: 'not-authenticated',
    });
  });

  it('clears the transcript, including an answer still streaming', async () => {
    const claude = scripted(['done'], 0, 'quick');
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const first = value(await chat.ask({ sessionId, question: 'Quick?' }));
    await settled(first.answer.id);
    expect(value(chat.clear({ sessionId }))).toEqual({ removed: 2 });
    expect(value(chat.list({ sessionId })).messages).toEqual([]);

    const slow = scripted(['a', 'b', 'c'], 500, 'slow');
    await services?.dispose();
    await start(slow);
    const streaming = value(await must(services).chat.ask({ sessionId, question: 'Slow?' }));
    updates = [];
    expect(value(must(services).chat.clear({ sessionId }))).toEqual({ removed: 2 });
    const again = value(await must(services).chat.ask({ sessionId, question: 'Again?' }));
    expect(again.answer.id).not.toBe(streaming.answer.id);
    value(must(services).chat.cancel({ messageId: again.answer.id }));
    await settled(again.answer.id);
    expect(updates.map(({ id }) => id)).toEqual([again.answer.id]);
    expect(value(must(services).chat.list({ sessionId })).messages).toHaveLength(2);
  });

  it('aborts an answer when the app quits, keeping what streamed', async () => {
    const { sessionId } = await start(scripted(['a', 'b'], 2000));
    const chat = must(services).chat;
    const asked = value(await chat.ask({ sessionId, question: 'Slow?' }));
    while (deltas.length === 0) {
      await delay(20);
    }
    await must(services).dispose();
    expect(await settled(asked.answer.id)).toMatchObject({ status: 'cancelled' });
    expect(await chat.ask({ sessionId, question: 'Too late?' })).toMatchObject({
      ok: false,
      error: { code: 'not-wired' },
    });
  });

  it('reads two mentions at their commits into the prompt, stores them and lists them', async () => {
    repo.git('switch', '--quiet', 'feature');
    repo.write('app.rs', 'fn main() {\n  run();\n  stop();\n}\n');
    repo.commit('stop too');
    repo.git('switch', '--quiet', 'main');
    const claude = scripted(['It returns [[feature.rs:2]].']);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const review = value(await must(services).sessions.getReview({ sessionId }));
    const mentions = [
      { path: 'feature.rs', side: 'head', startLine: 1, endLine: 2, sha: review.headSha },
      { path: 'app.rs', side: 'base', startLine: 2, endLine: 3, sha: review.baseSha },
    ] as const;
    const asked = value(
      await chat.ask({ sessionId, question: 'Why [[@1]] and not [[@2]]?', mentions }),
    );
    expect(asked.question).toMatchObject({ content: 'Why [[@1]] and not [[@2]]?', mentions });
    await settled(asked.answer.id);

    const [call] = calls(claude);
    const stdin = call?.stdin ?? '';
    const selected = stdin.indexOf('## Selected by the reviewer');
    expect(selected).toBeGreaterThan(-1);
    expect(selected).toBeLessThan(stdin.indexOf('## Diff'));
    expect(stdin).toContain(
      `### Selection 1: feature.rs:1-2 (head ${review.headSha.slice(0, 12)})`,
    );
    expect(stdin).toContain('1  pub fn feature() -> u8 {\n2    1\n```');
    expect(stdin).toContain(
      `### Selection 2: base:app.rs:2-3 (base ${review.baseSha.slice(0, 12)})`,
    );
    expect(stdin).toContain('2    run();\n3  }\n```');
    expect(stdin).toContain(
      'Why «selection 1: feature.rs:1-2» and not «selection 2: base:app.rs:2-3»?',
    );

    const listed = value(chat.list({ sessionId })).messages;
    expect(listed[0]).toMatchObject({ role: 'user', mentions });
    expect(listed[1]?.mentions).toEqual([]);

    const followUp = value(await chat.ask({ sessionId, question: 'And then?' }));
    await settled(followUp.answer.id);
    const second = calls(claude)[1]?.stdin ?? '';
    expect(second).not.toContain('## Selected by the reviewer');
    expect(second).toContain('[beuve: selection 1 was feature.rs:1-2]');
  });

  it('refuses mentions at another commit, of unknown files or past the end', async () => {
    const claude = scripted(['x']);
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const review = value(await must(services).sessions.getReview({ sessionId }));
    const refused = async (mention: {
      path: string;
      side: 'head' | 'base';
      startLine?: number;
      endLine?: number;
      sha: string;
    }): Promise<string> => {
      const result = await chat.ask({ sessionId, question: 'Why?', mentions: [mention] });
      if (result.ok) {
        throw new Error('expected a refusal');
      }
      expect(result.error.code).toBe('invalid-request');
      return result.error.message;
    };
    expect(
      await refused({
        path: 'feature.rs',
        side: 'head',
        startLine: 1,
        endLine: 1,
        sha: review.baseSha,
      }),
    ).toContain('Add it again');
    expect(await refused({ path: 'ghost.rs', side: 'head', sha: review.headSha })).toContain(
      'neither in the review nor tracked',
    );
    expect(await refused({ path: 'feature.rs', side: 'base', sha: review.baseSha })).toContain(
      'neither in the review nor tracked',
    );
    expect(
      await refused({
        path: 'feature.rs',
        side: 'head',
        startLine: 9,
        endLine: 9,
        sha: review.headSha,
      }),
    ).toContain('past the end');
    expect(value(chat.list({ sessionId })).messages).toEqual([]);

    const whole = value(
      await chat.ask({
        sessionId,
        question: 'Explain [[@1]]',
        mentions: [{ path: 'app.rs', side: 'head', sha: review.headSha }],
      }),
    );
    await settled(whole.answer.id);
    expect(calls(claude)[0]?.stdin).toContain(
      `### Selection 1: app.rs (head ${review.headSha.slice(0, 12)}, whole file of 3 lines)`,
    );
  });

  it('compacts the conversation into a summary that later prompts send instead of its turns', async () => {
    const claude = scripted(['The first answer about feature.'], 0, 'compact');
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    expect(await chat.compact({ sessionId })).toMatchObject({
      ok: false,
      error: { code: 'refused', message: expect.stringContaining('Nothing to compact') as string },
    });
    const first = value(await chat.ask({ sessionId, question: 'What is the first question?' }));
    await settled(first.answer.id);

    rescript(
      claude,
      ['**Asked**\n- what feature adds\n\n**Places**\n- [[feature.rs:1-3]] [[ghost.rs:1]]'],
      0,
    );
    const compacted = value(await chat.compact({ sessionId }));
    if (compacted.outcome !== 'compacted') {
      throw new Error(`expected a summary, got ${compacted.outcome}`);
    }
    expect(compacted.summary).toMatchObject({
      role: 'summary',
      status: 'complete',
      content: '**Asked**\n- what feature adds\n\n**Places**\n- [[feature.rs:1-3]] `ghost.rs:1-1`',
      citations: [{ path: 'feature.rs', startLine: 1, endLine: 3 }],
    });
    const compactCall = calls(claude)[1];
    expect(compactCall?.stdin).toContain('# Conversation to compact');
    expect(compactCall?.stdin).toContain('What is the first question?');
    expect(compactCall?.stdin).toContain('The first answer about feature.');
    expect(value(chat.list({ sessionId })).messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'summary',
    ]);
    expect(await chat.compact({ sessionId })).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    });

    rescript(claude, ['A later answer.'], 0);
    const later = value(await chat.ask({ sessionId, question: 'A question after the summary?' }));
    await settled(later.answer.id);
    const laterCall = calls(claude)[2]?.stdin ?? '';
    expect(laterCall).toContain('## Summary of the conversation so far');
    expect(laterCall).toContain('- what feature adds');
    expect(laterCall).not.toContain('What is the first question?');
    expect(laterCall).not.toContain('The first answer about feature.');

    expect(value(chat.clear({ sessionId }))).toEqual({ removed: 5 });
    expect(value(chat.list({ sessionId })).messages).toEqual([]);
  });

  it('queues a question behind a running compaction, and cancels the compaction alone', async () => {
    const claude = scripted(['Answer.'], 0, 'slow-compact');
    const { sessionId } = await start(claude);
    const chat = must(services).chat;
    const first = value(await chat.ask({ sessionId, question: 'Something?' }));
    await settled(first.answer.id);
    rescript(claude, ['a', 'b', 'c'], 1000);
    const running = chat.compact({ sessionId });
    while (calls(claude).length < 2) {
      await delay(20);
    }
    const next = value(await chat.ask({ sessionId, question: 'Now?' }));
    expect(next.answer.status).toBe('queued');
    expect(value(chat.cancel({ sessionId }))).toEqual({ cancelled: true });
    expect(value(await running)).toEqual({ outcome: 'cancelled' });
    rescript(claude, ['Later.'], 0);
    expect(await settled(next.answer.id)).toMatchObject({ status: 'complete', content: 'Later.' });
    expect(value(chat.list({ sessionId })).messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('rejects unknown sessions and shows an orphaned streaming answer as cancelled', async () => {
    const { sessionId } = await start(scripted(['x']));
    const chat = must(services).chat;
    expect(chat.list({ sessionId: 'nope' })).toMatchObject({ ok: false });
    expect(await chat.ask({ sessionId: 'nope', question: 'Hi?' })).toMatchObject({ ok: false });
    expect(chat.clear({ sessionId: 'nope' })).toMatchObject({ ok: false });

    const head = value(await must(services).sessions.getReview({ sessionId })).headSha;
    appendChatMessage(db, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ChatMessageId,
      sessionId: sessionId as SessionId,
      headSha: head as CommitSha,
      role: 'assistant',
      kind: 'answer',
      status: 'streaming',
      content: 'half an ans',
      citations: [],
      mentions: [],
      createdAt: '2026-10-28T11:00:00.000Z',
    });
    expect(value(chat.list({ sessionId })).messages).toMatchObject([
      { status: 'cancelled', content: 'half an ans' },
    ]);
  });
});

/**
 * `/summarize` straight through `createChatServices`, so the test can give the session a stated
 * intent (a pull request body) the way the GitHub services would.
 */
describe('createChatServices /summarize (integration: fake claude, a stated intent)', () => {
  it('summarizes from the diff alone, never sending the stated intent it gives questions', async () => {
    const repo = createTestRepository();
    const db = openAppDatabase(':memory:');
    const logger = createLogger('test', { sink: (): void => undefined });
    const deps = countingDeps();
    const script = writeFakeClaude(repo.scratch());
    const file = path.join(repo.scratch(), 'summary.json');
    writeFileSync(
      file,
      JSON.stringify({
        chunks: [
          '**What changed** It adds `feature` [[feature.rs:1-3]].\n\n',
          '**Why** Inferred: a placeholder.',
        ],
      }),
    );
    const claude = { command: process.execPath, leadingArgs: [script, 'chat', file] };
    repo.write('app.rs', 'fn main() {}\n');
    repo.commit('base');
    repo.git('switch', '--quiet', '--create', 'feature');
    repo.write('feature.rs', 'pub fn feature() -> u8 {\n  1\n}\n');
    repo.commit('add feature');
    repo.git('switch', '--quiet', 'main');
    const main = createMainServices({
      db,
      logger,
      deps,
      worktreeRoot: path.join(repo.scratch(), 'worktrees'),
      claude,
    });
    const worktreeRoot = path.join(repo.scratch(), 'chat-worktrees');
    const chat = createChatServices({
      context: { db, logger, deps, git: { logger } },
      impact: { getImpact: noImpact },
      worktrees: createSessionWorktrees({ root: worktreeRoot, logger, git: { logger } }),
      claude,
      intentFor: () => 'AUTHOR-CLAIM: this change makes everything faster.',
    });
    const updates: ChatMessageView[] = [];
    chat.onMessageUpdated(({ message }) => {
      updates.push(message);
    });
    try {
      const { id: sessionId } = value(
        await main.sessions.createLocal({
          repoPath: repo.directory,
          baseRef: 'main',
          headRef: 'feature',
        }),
      );
      const finished = async (id: string): Promise<ChatMessageView> => {
        for (let waited = 0; waited < 15_000; waited += 20) {
          const done = updates.find(
            (message) => message.id === id && !['queued', 'streaming'].includes(message.status),
          );
          if (done !== undefined) {
            return done;
          }
          await delay(20);
        }
        throw new Error('no answer');
      };
      const summary = value(
        await chat.ask({ sessionId, question: '/summarize', command: { kind: 'summarize' } }),
      );
      const question = value(await chat.ask({ sessionId, question: 'What is it for?' }));
      expect(summary.answer).toMatchObject({ answerKind: 'abstract', status: 'streaming' });
      expect(question.answer.status).toBe('queued');
      expect(await finished(summary.answer.id)).toMatchObject({
        status: 'complete',
        answerKind: 'abstract',
        citations: [{ path: 'feature.rs', startLine: 1, endLine: 3 }],
      });
      await finished(question.answer.id);
      const [summarized, asked] = calls(claude);
      expect(summarized?.args.some((arg) => arg.startsWith('--json-schema='))).toBe(false);
      expect(summarized?.stdin).toContain('## Task');
      expect(summarized?.stdin).toContain('feature.rs');
      expect(summarized?.stdin).not.toContain('AUTHOR-CLAIM');
      expect(summarized?.stdin).not.toContain('stated intent');
      expect(summarized?.args.join('\n')).toContain('**Why**');
      expect(asked?.stdin).toContain('AUTHOR-CLAIM');
    } finally {
      await chat.dispose();
      await main.dispose();
      db.close();
      repo.cleanup();
    }
  });
});

function modelFinding(path: string, line: number, severity: string, title: string): object {
  return {
    path,
    startLine: line,
    endLine: line,
    severity,
    category: 'edge-case',
    title,
    body: `**${title}**: check \`${path}\` line ${String(line)}.`,
    confidence: severity === 'risk' ? 0.9 : 0.8,
  };
}

/** Changes what the fake answers next, keeping its call log. */
function rescript(settings: ClaudeCodeSettings, chunks: string[], delayMs: number): void {
  writeFileSync(settings.leadingArgs?.[2] ?? '', JSON.stringify({ chunks, delayMs }));
}

function calls(settings: ClaudeCodeSettings): { args: string[]; cwd: string; stdin: string }[] {
  const file = `${settings.leadingArgs?.[2] ?? ''}.calls`;
  const lines = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
  return lines.map((line) => JSON.parse(line) as { args: string[]; cwd: string; stdin: string });
}

/** Waits until `isDone` holds, polling. */
async function waitUntil(isDone: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < 15_000; waited += 20) {
    if (isDone()) {
      return;
    }
    await delay(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function noImpact(): Promise<IpcResult<never>> {
  await Promise.resolve();
  return err({ code: 'not-wired', message: 'no impact here' });
}

function must<T>(item: T | undefined): T {
  if (item === undefined) {
    throw new Error('expected a value');
  }
  return item;
}

function value<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function countingDeps(): SessionDeps {
  let id = 0;
  return {
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}
