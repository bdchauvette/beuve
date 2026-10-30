import { describeModelError } from './describe-model-error.ts';
import { test } from '#testing/test.ts';

test('says how long a timed-out model was waited for, in the given locale', ({ expect }) => {
  const error = { kind: 'timeout', timeout: Temporal.Duration.from({ minutes: 2 }) } as const;

  expect(describeModelError(error, 'en')).toBe('No answer within 2m.');
  expect(describeModelError(error, 'fr')).toBe('No answer within 2min.');
});
