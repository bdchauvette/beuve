import path from 'node:path';

import type { TestOutcome, TestStatus } from './trace-runner.ts';

const maxFailure = 2000;

/**
 * Reads Vitest's JSON reporter output (the Jest-compatible shape every Vitest version writes) into
 * outcomes with `root`-relative files. A test file that failed before any test ran (a syntax error,
 * a stale instrumented source) becomes one failed outcome with no titles. `undefined` when the
 * text is not a report.
 */
export function parseVitestReport(text: string, root: string): TestOutcome[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || !Array.isArray(parsed.testResults)) {
    return undefined;
  }
  const outcomes: TestOutcome[] = [];
  for (const result of parsed.testResults) {
    if (!isObject(result) || typeof result.name !== 'string') {
      continue;
    }
    const file = path.relative(root, result.name);
    const assertions = Array.isArray(result.assertionResults) ? result.assertionResults : [];
    if (assertions.length === 0 && result.status === 'failed') {
      outcomes.push({
        file,
        titles: [],
        status: 'failed',
        durationMs: undefined,
        failure: bounded(typeof result.message === 'string' ? result.message : undefined),
      });
      continue;
    }
    for (const assertion of assertions) {
      const outcome = toOutcome(file, assertion);
      if (outcome !== undefined) {
        outcomes.push(outcome);
      }
    }
  }
  return outcomes;
}

function toOutcome(file: string, value: unknown): TestOutcome | undefined {
  if (!isObject(value) || typeof value.title !== 'string') {
    return undefined;
  }
  const ancestors = Array.isArray(value.ancestorTitles) ? value.ancestorTitles : [];
  const titles = [
    ...ancestors.filter((title): title is string => typeof title === 'string'),
    value.title,
  ];
  const messages = Array.isArray(value.failureMessages) ? value.failureMessages : [];
  const first: unknown = messages[0];
  return {
    file,
    titles,
    status: toStatus(value.status),
    durationMs: typeof value.duration === 'number' ? value.duration : undefined,
    failure: bounded(typeof first === 'string' ? first : undefined),
  };
}

function toStatus(status: unknown): TestStatus {
  return status === 'passed' || status === 'failed' ? status : 'skipped';
}

function bounded(text: string | undefined): string | undefined {
  return text === undefined || text.length <= maxFailure ? text : `${text.slice(0, maxFailure)}…`;
}

type Field =
  | 'testResults'
  | 'name'
  | 'status'
  | 'message'
  | 'assertionResults'
  | 'title'
  | 'ancestorTitles'
  | 'failureMessages'
  | 'duration';

function isObject(value: unknown): value is Partial<Record<Field, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
