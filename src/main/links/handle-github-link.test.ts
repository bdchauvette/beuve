import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { handleGithubLink } from './handle-github-link.ts';
import type { GithubLinkActions } from './handle-github-link.ts';

interface RecordingActions {
  readonly actions: GithubLinkActions;
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
      confirm: async ({ kind, text }): Promise<boolean> => {
        calls.push(`confirm ${kind} ${text}`);
        const isAnswered = await Promise.resolve(isConfirmed);
        return isAnswered;
      },
      reportInvalid: (reason): void => {
        calls.push(`invalid ${reason}`);
      },
      open: ({ kind, text }): void => {
        calls.push(`open ${kind} ${text}`);
      },
    },
  };
}

describe('handleGithubLink', () => {
  test('opens the pull request once confirmed', async ({ expect }) => {
    const { actions, calls } = recordingActions(true);
    await handleGithubLink(validLink(), actions);
    expect(calls).toStrictEqual([
      'confirm pull-request github.com/o/r#3',
      'open pull-request github.com/o/r#3',
    ]);
  });

  test('follows a branch once confirmed', async ({ expect }) => {
    const { actions, calls } = recordingActions(true);
    await handleGithubLink(
      `beuve://open?url=${encodeURIComponent('https://github.com/o/r/tree/claude/x')}`,
      actions,
    );
    expect(calls).toStrictEqual([
      'confirm branch github.com/o/r:claude/x',
      'open branch github.com/o/r:claude/x',
    ]);
  });

  test('opens nothing when declined', async ({ expect }) => {
    const { actions, calls } = recordingActions(false);
    await handleGithubLink(validLink(), actions);
    expect(calls).toStrictEqual(['confirm pull-request github.com/o/r#3']);
  });

  test('reports a link it cannot read without asking', async ({ expect }) => {
    const { actions, calls } = recordingActions(true);
    await handleGithubLink('beuve://clone', actions);
    expect(calls).toStrictEqual(['invalid unknown beuve:// action: clone']);
  });
});
