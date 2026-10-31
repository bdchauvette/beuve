import type { ChatFindingView, ChatMessageView } from '#contract/ipc-contract.ts';

import { createFindingView } from './create-finding-view.ts';

/** A completed `/review` answer at head `aaaa…` holding `findings`, with any field overridden. */
export function createReviewMessageView(
  findings: readonly ChatFindingView[] = [createFindingView()],
  overrides: Partial<ChatMessageView> = {},
): ChatMessageView {
  return {
    id: 'm1',
    sessionId: 's1',
    headSha: 'a'.repeat(40),
    role: 'assistant',
    parts: findings.map((_, finding) => {
      return {
        kind: 'finding',
        id: `p${String(finding + 1)}`,
        finding,
      };
    }),
    citations: [],
    createdAt: '2026-10-30T10:00:00.000Z',
    status: 'done',
    answerKind: 'review',
    review: {
      findings,
      dropped: {
        unknownFile: 0,
        outsideDiff: 0,
        lowConfidence: 0,
        duplicate: 0,
        overLimit: 0,
        unconfirmed: 0,
      },
      pathScope: [],
      fileCount: 1,
      verification: 'verified',
    },
    ...overrides,
  };
}
