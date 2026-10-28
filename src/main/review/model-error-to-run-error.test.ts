import { describe, expect, it } from 'vitest';

import { modelErrorToRunError } from './model-error-to-run-error.ts';

describe('modelErrorToRunError', () => {
  it('keeps the actionable failures typed', () => {
    expect(
      modelErrorToRunError({ kind: 'not-installed', command: 'claude' }, undefined),
    ).toMatchObject({ code: 'not-installed' });
    expect(
      modelErrorToRunError({ kind: 'not-authenticated', message: 'Please run /login' }, undefined),
    ).toMatchObject({ code: 'not-authenticated' });
    expect(
      modelErrorToRunError(
        { kind: 'rate-limited', message: '429', resetsAt: '2026-10-28T20:00:00.000Z' },
        undefined,
      ),
    ).toEqual({
      code: 'rate-limited',
      message: 'Claude Code is rate-limited: 429',
      resetsAt: '2026-10-28T20:00:00.000Z',
    });
    expect(modelErrorToRunError({ kind: 'timeout', timeoutMs: 600_000 }, undefined)).toEqual({
      code: 'timeout',
      message: 'Claude Code did not finish within 10 minutes.',
    });
  });

  it('says why a run was cancelled', () => {
    expect(modelErrorToRunError({ kind: 'cancelled' }, 'head-changed')).toMatchObject({
      code: 'cancelled',
      reason: 'head-changed',
    });
  });

  it('folds the rest into model-failed with the last stderr line', () => {
    expect(
      modelErrorToRunError(
        { kind: 'process-failed', exitCode: 2, signal: undefined, stderr: 'warn\nboom\n' },
        undefined,
      ),
    ).toEqual({ code: 'model-failed', message: 'Claude Code exited with 2: boom' });
  });
});
