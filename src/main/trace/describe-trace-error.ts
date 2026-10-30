import type { TraceFailureKind } from '#contract/ipc-contract.ts';
import type { TraceError } from '#internal/trace/trace-error.ts';
import { tailOf } from '#x/text/tail-of.ts';

export interface TraceFailureText {
  readonly failure: TraceFailureKind;
  readonly message: string;
}

const outputTailChars = 1200;

/**
 * What the reviewer or agent is told when a probe produced no trace. `stopReason` says why a
 * cancelled run was stopped.
 */
export function describeTraceError(error: TraceError, stopReason: string): TraceFailureText {
  switch (error.kind) {
    case 'untrusted': {
      return {
        failure: 'untrusted',
        message: 'This repository has not been approved to run its tests.',
      };
    }
    case 'invalid-path': {
      return {
        failure: 'runner-failed',
        message: `Cannot run tests: ${error.path} ${error.reason}.`,
      };
    }
    case 'vitest-not-found': {
      return {
        failure: 'not-vitest',
        message: `Vitest is not installed in ${error.searched}. Probes run the tests with Vitest from your clone's node_modules (npm install there first).`,
      };
    }
    case 'no-tests': {
      return {
        failure: 'no-tests-found',
        message: 'Vitest found no tests in the selected files (check its include patterns).',
      };
    }
    case 'timeout': {
      return {
        failure: 'timeout',
        message: `The tests took longer than ${String(error.timeout.round({ largestUnit: 'second', smallestUnit: 'second', roundingMode: 'halfExpand' }).seconds)} s and were stopped.`,
      };
    }
    case 'cancelled': {
      return { failure: 'cancelled', message: stopReason };
    }
    case 'run-failed': {
      const tail = tailOf(error.output, outputTailChars).trim();
      const how =
        error.signal === undefined
          ? `exit code ${String(error.exitCode ?? 'unknown')}`
          : `signal ${error.signal}`;
      return {
        failure: 'runner-failed',
        message: `Vitest ended without a report (${how}).${tail === '' ? '' : `\n${tail}`}`,
      };
    }
  }
}
