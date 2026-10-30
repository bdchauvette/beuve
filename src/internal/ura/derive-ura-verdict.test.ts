import { describe } from 'vitest';

import { deriveUraVerdict } from './derive-ura-verdict.ts';
import type { UraSeverity } from './ura-severities.ts';
import { test } from './testing/test.ts';

describe('deriveUraVerdict', () => {
  test.for<[UraSeverity[], string]>([
    [[], 'approve'],
    [['praise'], 'approve'],
    [['nit', 'nit', 'praise'], 'approve'],
    [['nit', 'question'], 'comment'],
    [['issue'], 'comment'],
    [['issue', 'blocker', 'praise'], 'request-changes'],
  ])('%j → %s', ([severities, verdict], { expect }) => {
    expect(deriveUraVerdict(severities)).toBe(verdict);
  });
});
