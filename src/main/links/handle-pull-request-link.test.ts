import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { handlePullRequestLink } from './handle-pull-request-link.ts';
import type { PullRequestLinkActions } from './handle-pull-request-link.ts';

interface RecordingActions {
  readonly actions: PullRequestLinkActions;
  readonly calls: string[];
}

function validLink(): string {
  return 'beuve://open?url=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F3';
}

function recordingActions(isConfirmed: boolean): RecordingActions {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      confirm: async (text): Promise<boolean> => {
        calls.push(`confirm ${text}`);
        const isAnswered = await Promise.resolve(isConfirmed);
        return isAnswered;
      },
      reportInvalid: (reason): void => {
        calls.push(`invalid ${reason}`);
      },
      open: (text): void => {
        calls.push(`open ${text}`);
      },
    },
  };
}

describe('handlePullRequestLink', () => {
  test('opens the pull request once confirmed', async ({ expect }) => {
    const { actions, calls } = recordingActions(true);
    await handlePullRequestLink(validLink(), actions);
    expect(calls).toStrictEqual(['confirm github.com/o/r#3', 'open github.com/o/r#3']);
  });

  test('opens nothing when declined', async ({ expect }) => {
    const { actions, calls } = recordingActions(false);
    await handlePullRequestLink(validLink(), actions);
    expect(calls).toStrictEqual(['confirm github.com/o/r#3']);
  });

  test('reports a link it cannot read without asking', async ({ expect }) => {
    const { actions, calls } = recordingActions(true);
    await handlePullRequestLink('beuve://clone', actions);
    expect(calls).toStrictEqual(['invalid unknown beuve:// action: clone']);
  });
});
