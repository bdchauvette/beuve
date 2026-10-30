import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ClaudeCodeResult } from './claude-code-event-from.ts';
import type { ModelError } from './language-model.ts';

/** What a finished `claude` process left behind, after the stream was read. */
export interface ClaudeCodeOutcome {
  readonly exitCode: number | undefined;
  readonly signal: string | undefined;
  /** The last few KiB of stderr. */
  readonly stderr: string;
  readonly result: ClaudeCodeResult | undefined;
  /** The latest `rate_limit_event` status that was not `allowed`, if any. */
  readonly rateLimit:
    { readonly status: string; readonly resetsAt: number | undefined } | undefined;
  /** Why the first unparseable stdout line was rejected, if there was one. */
  readonly invalidLine: string | undefined;
}

/** A successful run's output: for `json`, not yet checked against the request's schema. */
export interface ClassifiedOutput {
  readonly value: unknown;
  readonly result: ClaudeCodeResult;
}

/**
 * Turns a finished run into its answer or a {@link ModelError}. `json` expects structured output
 * (or the result text as JSON), still unvalidated; `text` expects a non-blank result text.
 * Authentication and rate-limit failures are recognized from HTTP statuses, the stream's rate-limit
 * events and Claude Code's `/login` hints. These texts are not a documented interface, so anything
 * unrecognized falls through to `model-failed` or `process-failed` with the message intact.
 */
export function classifyClaudeCodeOutcome(
  outcome: ClaudeCodeOutcome,
  expects: 'json' | 'text' = 'json',
): Result<ClassifiedOutput, ModelError> {
  const { result } = outcome;
  if (result === undefined) {
    return err(withoutResult(outcome));
  }
  if (result.isError) {
    return err(failedResult(result, outcome));
  }
  if (expects === 'text') {
    return result.text === undefined || result.text.trim() === ''
      ? err({ kind: 'invalid-output', reason: 'the result has no text' })
      : ok({ value: result.text, result });
  }
  if (result.hasStructuredOutput) {
    return ok({ value: result.structuredOutput, result });
  }
  const parsed = parseResultText(result.text);
  return parsed.ok ? ok({ value: parsed.value, result }) : parsed;
}

const authenticationPattern =
  /not logged in|please run \/login|invalid api key|authentication_error|oauth token has expired|credentials/iu;
const rateLimitPattern = /rate.?limit|usage limit|overloaded|too many requests/iu;
const stderrTailChars = 2000;

function withoutResult(outcome: ClaudeCodeOutcome): ModelError {
  const stderr = outcome.stderr.trim().slice(-stderrTailChars);
  if (authenticationPattern.test(stderr)) {
    return { kind: 'not-authenticated', message: stderr };
  }
  if (outcome.exitCode === 0 && outcome.signal === undefined) {
    return {
      kind: 'invalid-output',
      reason:
        outcome.invalidLine === undefined
          ? 'the run ended without a result event'
          : `the run ended without a result event (${outcome.invalidLine})`,
    };
  }
  return { kind: 'process-failed', exitCode: outcome.exitCode, signal: outcome.signal, stderr };
}

function failedResult(result: ClaudeCodeResult, outcome: ClaudeCodeOutcome): ModelError {
  const message = (result.text ?? outcome.stderr).trim().slice(-stderrTailChars);
  const status = result.apiErrorStatus;
  if (status === 401 || status === 403 || authenticationPattern.test(message)) {
    return { kind: 'not-authenticated', message };
  }
  if (
    status === 429 ||
    status === 529 ||
    outcome.rateLimit !== undefined ||
    rateLimitPattern.test(message)
  ) {
    const resetsAt = outcome.rateLimit?.resetsAt;
    return {
      kind: 'rate-limited',
      message,
      resetsAt:
        resetsAt === undefined
          ? undefined
          : Temporal.Instant.fromEpochMilliseconds(Math.round(resetsAt * 1000)).toString({
              fractionalSecondDigits: 3,
            }),
    };
  }
  return {
    kind: 'model-failed',
    reason: result.subtype,
    message,
    ...(status !== undefined && { status }),
  };
}

function parseResultText(text: string | undefined): Result<unknown, ModelError> {
  if (text === undefined) {
    return err({ kind: 'invalid-output', reason: 'the result has no structured output' });
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return err({ kind: 'invalid-output', reason: 'the result is not JSON' });
  }
}
