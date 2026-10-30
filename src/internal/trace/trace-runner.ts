import type { Result } from '#x/result/result.ts';

import type { TraceError } from './trace-error.ts';
import type { TraceRecord } from './trace-record.ts';

/** A module whose text the runner swaps for `code` while the tests load it. */
export interface InstrumentedFile {
  /** Worktree-relative path. */
  readonly path: string;
  /** The text on disk; a mismatch fails the test file instead of tracing stale code. */
  readonly original: string;
  readonly code: string;
}

export interface TraceRunRequest {
  /**
   * The reviewer allowed this repository to run its own tests and config (ADR 0036). Main checks
   * its stored trust before setting it; the runner refuses anything else.
   */
  readonly trusted: true;
  /** The beuve-managed checkout of the head (ADR 0020). Never written to. */
  readonly worktree: string;
  /** A directory whose `node_modules` provides Vitest and the project's dependencies. */
  readonly dependencyRoot: string;
  /** Worktree-relative test files to run. */
  readonly testFiles: readonly string[];
  /** Vitest's `--testNamePattern`. */
  readonly testNamePattern?: string;
  readonly files: readonly InstrumentedFile[];
  readonly timeout: Temporal.Duration;
  readonly signal?: AbortSignal | undefined;
}

export type TestStatus = 'passed' | 'failed' | 'skipped';

/** One test's result, or a test file that failed to load (no titles). */
export interface TestOutcome {
  /** Worktree-relative. */
  readonly file: string;
  readonly titles: readonly string[];
  readonly status: TestStatus;
  readonly duration: Temporal.Duration | undefined;
  /** First failure message, bounded. */
  readonly failure: string | undefined;
}

export interface TraceRunOutput {
  /** Records with worktree-relative test files. */
  readonly records: readonly TraceRecord[];
  readonly outcomes: readonly TestOutcome[];
  readonly duration: Temporal.Duration;
}

/** Runs tests against instrumented sources and collects the recorder's output (ADR 0036). */
export interface TraceRunner {
  readonly run: (request: TraceRunRequest) => Promise<Result<TraceRunOutput, TraceError>>;
}
