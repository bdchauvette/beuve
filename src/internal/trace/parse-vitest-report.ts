import path from 'node:path';

import type { TestOutcome, TestStatus } from './trace-runner.ts';

const maxFailure = 2000;

export interface VitestReportPaths {
  /** The directory test files are reported relative to. */
  readonly root: string;
}

/**
 * Reads Vitest's JSON reporter output (the Jest-compatible shape every Vitest version writes) into
 * outcomes with `root`-relative files. A test file that failed before any test ran (a syntax error,
 * a stale instrumented source) becomes one failed outcome with no titles. `undefined` when the
 * text is not a report.
 */
export function parseVitestReport(
  text: string,
  { root }: VitestReportPaths,
): TestOutcome[] | undefined {
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
    const assertions = listOf(result.assertionResults);
    if (assertions.length === 0 && result.status === 'failed') {
      outcomes.push({
        file,
        titles: [],
        status: 'failed',
        duration: undefined,
        failure: bounded(stringOf(result.message)),
      });
      continue;
    }
    for (const assertion of assertions) {
      const outcome = outcomeFrom(file, assertion);
      if (outcome !== undefined) {
        outcomes.push(outcome);
      }
    }
  }
  return outcomes;
}

function outcomeFrom(file: string, value: unknown): TestOutcome | undefined {
  if (!isObject(value) || typeof value.title !== 'string') {
    return undefined;
  }
  const ancestors = listOf(value.ancestorTitles);
  const titles = [
    ...ancestors.filter((title): title is string => typeof title === 'string'),
    value.title,
  ];
  const [first] = listOf(value.failureMessages);
  return {
    file,
    titles,
    status: statusFrom(value.status),
    duration: durationOf(value.duration),
    failure: bounded(stringOf(first)),
  };
}

function statusFrom(status: unknown): TestStatus {
  if (status === 'passed' || status === 'failed') {
    return status;
  }
  return 'skipped';
}

function bounded(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= maxFailure) {
    return text;
  }
  return `${text.slice(0, maxFailure)}…`;
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

function listOf(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value as unknown[];
  }
  return [];
}

function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

function durationOf(milliseconds: unknown): Temporal.Duration | undefined {
  if (typeof milliseconds !== 'number') {
    return undefined;
  }
  return Temporal.Duration.from({ milliseconds: Math.round(milliseconds) });
}
