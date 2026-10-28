import { readFileSync, writeFileSync } from 'node:fs';
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
import type { TestRepository } from '#internal/git/testing/create-test-repository.ts';
import { writeFakeClaude } from '#internal/llm/testing/write-fake-claude.ts';
import type { SessionDeps } from '#internal/session/session.ts';
import { createLogger } from '#pkg/logger/create-logger.ts';

import { createMainServices } from '../create-main-services.ts';
import { openAppDatabase } from '../database/open-app-database.ts';
import type { MainServices } from '../main-services.ts';
import type { ClaudeCodeSettings } from '../review/claude-code-settings.ts';

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
    deps = steppingDeps();
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
      claude: { killGraceMs: 200, ...claude },
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

  const scripted = (chunks: string[], delayMs = 0, name = 'chat'): ClaudeCodeSettings => {
    const file = path.join(repo.scratch(), `${name}.json`);
    writeFileSync(file, JSON.stringify({ preamble: 'Looking.', chunks, delayMs }));
    return { command: process.execPath, leadingArgs: [script, 'chat', file] };
  };

  const settled = async (messageId: string): Promise<ChatMessageView> => {
    for (let waited = 0; waited < 15_000; waited += 20) {
      const update = updates.find((message) => message.id === messageId);
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

  it('refuses a second question while one streams, and cancels the first', async () => {
    const { sessionId } = await start(scripted(['a', 'b', 'c', 'd'], 400));
    const chat = must(services).chat;
    const first = value(await chat.ask({ sessionId, question: 'Slow one?' }));
    expect(await chat.ask({ sessionId, question: 'Another?' })).toMatchObject({
      ok: false,
      error: { code: 'refused', message: expect.stringContaining('still streaming') as string },
    });
    while (deltas.every(({ kind, text }) => !(kind === 'append' && text === 'a'))) {
      await delay(20);
    }
    expect(value(chat.cancel({ messageId: first.answer.id }))).toEqual({ cancelled: true });
    const cancelled = await settled(first.answer.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', content: 'a' });
    expect(value(chat.cancel({ messageId: first.answer.id }))).toEqual({ cancelled: false });

    const next = value(await chat.ask({ sessionId, question: 'Another?' }));
    expect(next.answer.status).toBe('streaming');
    value(chat.cancel({ messageId: next.answer.id }));
    await settled(next.answer.id);
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

  it('rejects unknown sessions and shows an orphaned streaming answer as cancelled', async () => {
    const { sessionId } = await start(scripted(['x']));
    const chat = must(services).chat;
    expect(chat.list({ sessionId: 'nope' })).toMatchObject({ ok: false });
    expect(await chat.ask({ sessionId: 'nope', question: 'Hi?' })).toMatchObject({ ok: false });
    expect(chat.clear({ sessionId: 'nope' })).toMatchObject({ ok: false });

    const head = value(must(services).sessions.open({ sessionId })).headSha;
    appendChatMessage(db, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ChatMessageId,
      sessionId: sessionId as SessionId,
      headSha: head as CommitSha,
      role: 'assistant',
      status: 'streaming',
      content: 'half an ans',
      citations: [],
      createdAt: '2026-10-28T11:00:00.000Z',
    });
    expect(value(chat.list({ sessionId })).messages).toMatchObject([
      { status: 'cancelled', content: 'half an ans' },
    ]);
  });
});

function calls(settings: ClaudeCodeSettings): { args: string[]; cwd: string; stdin: string }[] {
  const file = `${settings.leadingArgs?.[2] ?? ''}.calls`;
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { args: string[]; cwd: string; stdin: string });
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

function steppingDeps(): SessionDeps {
  let tick = 0;
  let id = 0;
  return {
    now: (): Date => new Date(Date.UTC(2026, 9, 28, 12, 0, tick++)),
    newId: (): string => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  };
}
