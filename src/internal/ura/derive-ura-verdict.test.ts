import { describe, expect, it } from 'vitest';

import { deriveUraVerdict } from './derive-ura-verdict.ts';
import type { UraSeverity } from './ura-severities.ts';

describe('deriveUraVerdict', () => {
  it.each<[UraSeverity[], string]>([
    [[], 'approve'],
    [['praise'], 'approve'],
    [['nit', 'nit', 'praise'], 'approve'],
    [['nit', 'question'], 'comment'],
    [['issue'], 'comment'],
    [['issue', 'blocker', 'praise'], 'request-changes'],
  ])('%j → %s', (severities, verdict) => {
    expect(deriveUraVerdict(severities)).toBe(verdict);
  });
});
