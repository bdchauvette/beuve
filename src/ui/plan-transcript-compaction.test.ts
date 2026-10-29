import { describe, expect, it } from 'vitest';

import type { ChatMessageView } from '#contract/ipc-contract.ts';

import type { ChatEntry } from './chat-entry.ts';
import { planTranscriptCompaction } from './plan-transcript-compaction.ts';

function message(id: string, role: ChatMessageView['role']): ChatEntry {
  return {
    id,
    kind: 'message',
    message: {
      id,
      sessionId: 's1',
      headSha: 'a'.repeat(40),
      role,
      content: id,
      citations: [],
      mentions: [],
      status: 'complete',
      createdAt: '2026-10-28T12:00:00.000Z',
    },
  };
}

describe('planTranscriptCompaction', () => {
  it('folds nothing without a summary', () => {
    expect(planTranscriptCompaction([message('q', 'user')])).toEqual({
      boundary: -1,
      compactedMessages: 0,
    });
  });

  it('folds every message before the latest summary, older summaries included', () => {
    const entries: ChatEntry[] = [
      message('q1', 'user'),
      message('a1', 'assistant'),
      { id: 1, kind: 'note', tone: 'info', lines: ['local'] },
      message('s1', 'summary'),
      message('q2', 'user'),
      message('s2', 'summary'),
      message('q3', 'user'),
    ];
    expect(planTranscriptCompaction(entries)).toEqual({ boundary: 5, compactedMessages: 4 });
  });
});
