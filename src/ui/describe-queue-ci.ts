import type { QueueCiView } from '#contract/ipc-contract.ts';

/** A queue row's CI dot: its color and what it says on hover. */
export interface QueueCiDot {
  readonly tone: 'ok' | 'warn' | 'danger' | 'muted';
  readonly title: string;
}

/** The CI of a queue item's head as a dot; unknown CI is a muted one. Pure. */
export function describeQueueCi(ci: QueueCiView | undefined): QueueCiDot {
  switch (ci?.overall) {
    case undefined: {
      return { tone: 'muted', title: 'CI not read yet' };
    }
    case 'failure': {
      let checks = `${String(ci.failing)} checks`;
      if (ci.failing === 1) {
        checks = '1 check';
      }
      return { tone: 'danger', title: `CI failing (${checks})` };
    }
    case 'pending': {
      return { tone: 'warn', title: 'CI running' };
    }
    case 'success': {
      return { tone: 'ok', title: 'CI passing' };
    }
    case 'neutral': {
      return { tone: 'muted', title: 'CI skipped or neutral' };
    }
    case 'none': {
      return { tone: 'muted', title: 'No CI on the head' };
    }
  }
}
