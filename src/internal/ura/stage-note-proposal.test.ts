import { describe } from 'vitest';

import { stageNoteProposal } from './stage-note-proposal.ts';
import type { NoteProposalSource, StageableNoteProposal } from './stage-note-proposal.ts';
import { testUraIds } from './testing/test-ura-ids.ts';
import { test } from './testing/test.ts';

describe('stageNoteProposal', () => {
  test('stages the note on its lines with its label, naming its answer and index', ({
    expect,
    deps,
  }) => {
    expect(stageNoteProposal(proposal(), source(), { deps })).toMatchObject({
      ok: true,
      value: {
        sessionId: source().sessionId,
        headSha: source().headSha,
        anchor: { kind: 'lines', path: 'src/a.ts', startLine: 4, endLine: 6 },
        severity: 'question',
        blocking: true,
        origin: { kind: 'chat-answer', messageId: testUraIds.messageId, proposal: 1 },
        title: '',
        body: proposal().body,
        status: { kind: 'staged' },
      },
    });
  });

  test('takes the label the reviewer picked over the proposed one', ({ expect, deps }) => {
    const chosen = stageNoteProposal(proposal(), source(), { deps, severity: 'nitpick' });
    expect(chosen.ok && chosen.value.severity).toBe('nitpick');
  });
});

function proposal(): StageableNoteProposal {
  return {
    path: 'src/a.ts',
    startLine: 4,
    endLine: 6,
    label: 'question',
    blocking: true,
    title: '',
    body: 'Why does this retry forever?',
  };
}

function source(): NoteProposalSource {
  return {
    sessionId: testUraIds.sessionId,
    headSha: testUraIds.headSha,
    messageId: testUraIds.messageId,
    proposal: 1,
  };
}
