import { formatDuration } from './format-duration.ts';
import { test } from '#testing/test.ts';

test.for([
  [{ milliseconds: 712 }, '712ms'],
  [{ milliseconds: 1234 }, '1s 234ms'],
  [{ seconds: 30 }, '30s'],
  [{ seconds: 90 }, '1m 30s'],
  [{ minutes: 2 }, '2m'],
  [{ minutes: 125 }, '2h 5m'],
  [{ microseconds: 600 }, '1ms'],
  [{ microseconds: 400 }, '0ms'],
  [{ seconds: 0 }, '0ms'],
] as const)('%j reads %s in English', ([fields, expected], { expect }) => {
  expect(formatDuration(Temporal.Duration.from(fields), 'en')).toBe(expected);
});

test('follows the locale it is given', ({ expect }) => {
  const duration = Temporal.Duration.from({ seconds: 1, milliseconds: 234 });

  expect(formatDuration(duration, 'de')).toBe('1 Sek., 234 ms');
  expect(formatDuration(duration, 'fr')).toBe('1s 234ms');
});

test('rounds to the nearest millisecond', ({ expect }) => {
  const duration = Temporal.Duration.from('PT0.9996S');

  expect(formatDuration(duration, 'en')).toBe('1s');
});

test('takes the Intl.DurationFormat style', ({ expect }) => {
  const duration = Temporal.Duration.from({ seconds: 90 });

  expect(formatDuration(duration, 'en', 'long')).toBe('1 minute, 30 seconds');
  expect(formatDuration(duration, 'en', 'digital')).toBe('0:01:30');
  expect(formatDuration(new Temporal.Duration(), 'en', 'long')).toBe('0 milliseconds');
});
