import { describe } from 'vitest';

import { deriveUraVerdict } from './derive-ura-verdict.ts';
import type { UraItemLabel } from './ura-item.ts';
import type { UraSeverity } from './ura-severities.ts';
import { test } from './testing/test.ts';

describe('deriveUraVerdict', () => {
  test.for<[UraItemLabel[], string]>([
    [[], 'approve'],
    [[note('praise')], 'approve'],
    [[note('nitpick'), note('quibble'), note('praise'), note('smell'), note('thought')], 'approve'],
    [[note('note'), note('polish')], 'approve'],
    [[note('nitpick'), note('question')], 'comment'],
    [[note('issue')], 'comment'],
    [[note('suggestion')], 'comment'],
    [[note('todo')], 'comment'],
    [[note('chore')], 'comment'],
    [[note('typo')], 'comment'],
    [[note('issue'), { severity: 'issue', blocking: true }, note('praise')], 'request-changes'],
    [[{ severity: 'nitpick', blocking: true }], 'request-changes'],
  ])('%j → %s', ([items, verdict], { expect }) => {
    expect(deriveUraVerdict(items)).toBe(verdict);
  });
});

function note(severity: UraSeverity): UraItemLabel {
  return { severity, blocking: false };
}
