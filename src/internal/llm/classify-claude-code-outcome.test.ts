import { describe, expect, it } from 'vitest';

import { classifyClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeResult } from './parse-claude-code-event.ts';

const success: ClaudeCodeResult = {
  subtype: 'success',
  isError: false,
  text: '{"a":1}',
  hasStructuredOutput: true,
  structuredOutput: { a: 1 },
  apiErrorStatus: undefined,
  turns: 1,
  costUsd: 0,
  durationMs: 1,
  deniedToolUses: 0,
};

function outcome(overrides: Partial<ClaudeCodeOutcome>): ClaudeCodeOutcome {
  return {
    exitCode: 0,
    signal: undefined,
    stderr: '',
    result: success,
    rateLimit: undefined,
    invalidLine: undefined,
    ...overrides,
  };
}

function failed(fields: Partial<ClaudeCodeResult>): ClaudeCodeResult {
  return { ...success, isError: true, hasStructuredOutput: false, ...fields };
}

describe('classifyClaudeCodeOutcome', () => {
  it('returns the structured output, or the result text parsed as JSON', () => {
    expect(classifyClaudeCodeOutcome(outcome({}))).toEqual({
      ok: true,
      value: { value: { a: 1 }, result: success },
    });
    const textOnly = { ...success, hasStructuredOutput: false, structuredOutput: undefined };
    expect(classifyClaudeCodeOutcome(outcome({ result: textOnly }))).toMatchObject({
      ok: true,
      value: { value: { a: 1 } },
    });
    expect(classifyClaudeCodeOutcome(outcome({ result: { ...textOnly, text: 'prose' } }))).toEqual({
      ok: false,
      error: { kind: 'invalid-output', reason: 'the result is not JSON' },
    });
  });

  it('returns the result text as is when text is expected, and rejects a blank one', () => {
    const prose = { ...success, hasStructuredOutput: false, text: 'See [[a.ts:1-2]].' };
    expect(classifyClaudeCodeOutcome(outcome({ result: prose }), 'text')).toEqual({
      ok: true,
      value: { value: 'See [[a.ts:1-2]].', result: prose },
    });
    expect(
      classifyClaudeCodeOutcome(outcome({ result: { ...prose, text: ' \n' } }), 'text'),
    ).toEqual({ ok: false, error: { kind: 'invalid-output', reason: 'the result has no text' } });
    const unauthorized = outcome({ result: failed({ apiErrorStatus: 401 }) });
    expect(classifyClaudeCodeOutcome(unauthorized, 'text')).toMatchObject({
      ok: false,
      error: { kind: 'not-authenticated' },
    });
  });

  it('maps authentication failures from HTTP status or the /login hint', () => {
    for (const result of [
      failed({ apiErrorStatus: 401, text: 'API Error' }),
      failed({ text: 'Invalid API key · Please run /login' }),
    ]) {
      expect(classifyClaudeCodeOutcome(outcome({ result, exitCode: 1 }))).toMatchObject({
        ok: false,
        error: { kind: 'not-authenticated' },
      });
    }
    expect(
      classifyClaudeCodeOutcome(
        outcome({ result: undefined, exitCode: 1, stderr: 'Not logged in · Please run /login' }),
      ),
    ).toMatchObject({ ok: false, error: { kind: 'not-authenticated' } });
  });

  it('maps rate limits, with the reset time from a rejected rate-limit event', () => {
    const limited = outcome({
      result: failed({ text: 'Claude usage limit reached' }),
      rateLimit: { status: 'rejected', resetsAt: 0 },
    });
    expect(classifyClaudeCodeOutcome(limited)).toEqual({
      ok: false,
      error: {
        kind: 'rate-limited',
        message: 'Claude usage limit reached',
        resetsAt: '1970-01-01T00:00:00.000Z',
      },
    });
    const overloaded = outcome({ result: failed({ apiErrorStatus: 529, text: 'x' }) });
    expect(classifyClaudeCodeOutcome(overloaded)).toMatchObject({
      ok: false,
      error: { kind: 'rate-limited', resetsAt: undefined },
    });
  });

  it('keeps other error results as model failures with their subtype', () => {
    const crashed = outcome({
      result: failed({ subtype: 'error_during_execution', text: 'tool crashed' }),
    });
    expect(classifyClaudeCodeOutcome(crashed)).toEqual({
      ok: false,
      error: { kind: 'model-failed', reason: 'error_during_execution', message: 'tool crashed' },
    });
  });

  it('distinguishes a crash from a clean exit without a result', () => {
    expect(
      classifyClaudeCodeOutcome(
        outcome({ result: undefined, exitCode: undefined, signal: 'SIGSEGV', stderr: 'core' }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: 'process-failed', exitCode: undefined, signal: 'SIGSEGV', stderr: 'core' },
    });
    expect(classifyClaudeCodeOutcome(outcome({ result: undefined }))).toEqual({
      ok: false,
      error: { kind: 'invalid-output', reason: 'the run ended without a result event' },
    });
  });
});
