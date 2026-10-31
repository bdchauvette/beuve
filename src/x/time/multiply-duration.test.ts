import { multiplyDuration } from './multiply-duration.ts';
import { test } from '#testing/test.ts';

test('repeats a duration a whole number of times', ({ expect }) => {
  expect(multiplyDuration(Temporal.Duration.from({ seconds: 90 }), 5)).toStrictEqual(
    Temporal.Duration.from({ seconds: 450 }),
  );
  const second = multiplyDuration(Temporal.Duration.from({ milliseconds: 250 }), 4);
  expect(Temporal.Duration.compare(second, { seconds: 1 })).toBe(0);
});

test('zero times is a zero duration', ({ expect }) => {
  expect(multiplyDuration(Temporal.Duration.from({ minutes: 1 }), 0).sign).toBe(0);
});

test('rejects fractions and negatives', ({ expect }) => {
  expect(() => {
    return multiplyDuration(Temporal.Duration.from({ seconds: 1 }), 1.5);
  }).toThrow(RangeError);
  expect(() => {
    return multiplyDuration(Temporal.Duration.from({ seconds: 1 }), -1);
  }).toThrow(RangeError);
});
