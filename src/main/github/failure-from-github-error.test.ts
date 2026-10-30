import { failureFromGithubError } from './failure-from-github-error.ts';
import { test } from '#testing/test.ts';

test('says how long a GitHub request waited for an answer', ({ expect }) => {
  const timeout = Temporal.Duration.from({ seconds: 20 });

  expect(failureFromGithubError({ kind: 'timeout', timeout }, 'a/b#1', 'en').message).toBe(
    'GitHub request failed: no answer within 20s',
  );
});
