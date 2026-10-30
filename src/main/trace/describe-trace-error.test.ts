import { describeTraceError } from './describe-trace-error.ts';
import { test } from '#testing/test.ts';

test('says how long the tests ran before they were stopped', ({ expect }) => {
  const error = { kind: 'timeout', timeout: Temporal.Duration.from({ seconds: 90 }) } as const;

  expect(describeTraceError(error, 'stopped', 'en')).toStrictEqual({
    failure: 'timeout',
    message: 'The tests took longer than 1m 30s and were stopped.',
  });
});
