import { describe } from 'vitest';

import { createChatHarness } from './testing/create-chat-harness.ts';
import { test } from './testing/test.ts';

describe('ChatController', () => {
  test('subscribes to chat:stream while the host is connected', ({ expect }) => {
    const { chat, listening } = createChatHarness();
    chat.hostConnected();
    expect(listening()).toBe(true);
    chat.hostDisconnected();
    expect(listening()).toBe(false);
  });

  test('ignores a stream event of another session', ({ expect }) => {
    const { chat, emit, updates } = createChatHarness({ sessionId: 's1' });
    chat.hostConnected();
    emit({ sessionId: 's2', messageId: 'm1', type: 'status', status: 'streaming' });
    expect(chat.entries).toStrictEqual([]);
    expect(updates()).toBe(0);
  });

  test('answers a question without a session with a note and no request', async ({ expect }) => {
    const { chat, invoked } = createChatHarness();
    chat.submit('what changed?');
    expect(chat.entries).toStrictEqual([
      {
        id: 1,
        kind: 'note',
        tone: 'error',
        lines: ['Open a review session first, then ask your question.'],
      },
    ]);
    expect(invoked).toStrictEqual([]);
    await chat.clear(true);
  });

  test('sends a question with the focused file and mentions', async ({ expect }) => {
    const { chat, invoked } = createChatHarness({ sessionId: 's1', focusPath: 'src/a.ts' });
    chat.submit('why?');
    await expect.poll(() => invoked.length).toBe(1);
    expect(invoked).toStrictEqual([
      ['chat:ask', { sessionId: 's1', question: 'why?', focus: { path: 'src/a.ts' } }],
    ]);
  });

  test('shows the stored question and answer, and cancels the running answer', async ({
    expect,
  }) => {
    const { chat, invoked } = createChatHarness({ sessionId: 's1', answerStatus: 'streaming' });
    chat.submit('why?');
    await expect.poll(() => chat.entries.length).toBe(2);
    expect(chat.isBusy).toBe(true);
    chat.cancelRunning();
    await expect.poll(() => invoked.at(-1)).toStrictEqual(['chat:cancel', { messageId: 'a1' }]);
  });

  test('puts a rejected question back in the input', async ({ expect }) => {
    const { chat, drafts } = createChatHarness({ sessionId: 's1', failWith: 'busy' });
    chat.submit('why?');
    await expect.poll(() => drafts).toStrictEqual(['why?']);
    expect(chat.entries).toStrictEqual([{ id: 1, kind: 'note', tone: 'error', lines: ['busy'] }]);
  });

  test('echoes /help with its lines', ({ expect }) => {
    const { chat } = createChatHarness();
    chat.submit('/help');
    expect(chat.entries.map(({ kind }) => kind)).toStrictEqual(['input', 'note']);
  });

  test('echoes a malformed command and says how to fix it', ({ expect }) => {
    const { chat } = createChatHarness();
    chat.submit('/nonsense');
    expect(chat.entries.map(({ kind }) => kind)).toStrictEqual(['input', 'note']);
  });

  test('hands a preference command to the app after echoing it', ({ expect }) => {
    const { chat, appCommands } = createChatHarness();
    chat.submit('/diff split');
    expect(chat.entries).toStrictEqual([{ id: 1, kind: 'input', text: '/diff split' }]);
    expect(appCommands).toStrictEqual([{ kind: 'diff', layout: 'split' }]);
  });

  test('ignores an empty line', ({ expect }) => {
    const { chat, updates } = createChatHarness();
    chat.submit(' '.repeat(3));
    expect(chat.entries).toStrictEqual([]);
    expect(updates()).toBe(0);
  });

  test('/clear without a session empties the local entries', async ({ expect }) => {
    const { chat, invoked } = createChatHarness();
    chat.note('info', 'hello');
    await chat.clear();
    expect(chat.entries).toStrictEqual([]);
    expect(invoked).toStrictEqual([]);
  });

  test('/clear queue without a session keeps the local entries', async ({ expect }) => {
    const { chat } = createChatHarness();
    chat.note('info', 'hello');
    await chat.clear(true);
    expect(chat.entries).toHaveLength(1);
  });

  test('/clear deletes the stored transcript and the entries', async ({ expect }) => {
    const { chat, invoked } = createChatHarness({ sessionId: 's1' });
    chat.note('info', 'hello');
    await chat.clear();
    expect(invoked).toStrictEqual([['chat:clear', { sessionId: 's1' }]]);
    expect(chat.entries).toStrictEqual([]);
  });

  test('/clear queue reloads what is left', async ({ expect }) => {
    const { chat, invoked } = createChatHarness({ sessionId: 's1' });
    await chat.clear(true);
    expect(invoked).toStrictEqual([
      ['chat:clear', { sessionId: 's1', queuedOnly: true }],
      ['chat:list', { sessionId: 's1' }],
    ]);
  });

  test('is not busy and cancels nothing without a running request', ({ expect }) => {
    const { chat, invoked } = createChatHarness({ sessionId: 's1' });
    chat.cancelRunning();
    expect(chat.isBusy).toBe(false);
    expect(invoked).toStrictEqual([]);
  });

  test('requests a re-render when its entries change', ({ expect }) => {
    const { chat, updates } = createChatHarness();
    chat.note('info', 'a');
    chat.reset();
    expect(updates()).toBe(2);
  });
});
