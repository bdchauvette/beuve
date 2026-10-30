import { createRuleTester } from './create-rule-tester.ts';
import { requireSequentialFakeTime } from './require-sequential-fake-time.ts';

createRuleTester().run('require-sequential-fake-time', requireSequentialFakeTime, {
  valid: [
    "test('a', { concurrent: false }, ({ clock }) => { clock.advance({ minutes: 1 }); });",
    "test('a', { concurrent: false }, () => { vi.useFakeTimers(); vi.useRealTimers(); });",
    "describe('d', { concurrent: false }, () => { test('a', () => { vi.setSystemTime('2026-10-28T12:00:00Z'); }); });",
    "test('a', ({ tempDir }) => { return tempDir; });",
    "test.each([1, 2])('a %i', { concurrent: false }, (n, { clock }) => { clock.set('2026-10-28T12:00:00Z'); });",
    {
      code: "test('a', ({ timers }) => { timers.tick(); });",
      options: [{ fixtures: ['clock'] }],
    },
  ],
  invalid: [
    {
      code: "test('a', ({ clock }) => { clock.advance({ minutes: 1 }); });",
      errors: [{ messageId: 'notSequential', data: { how: 'the `clock` fixture' } }],
    },
    {
      code: "it('a', async () => { vi.useFakeTimers(); await Promise.resolve(); });",
      errors: [{ messageId: 'notSequential', data: { how: 'vi.useFakeTimers()' } }],
    },
    {
      code: "test('a', { timeout: 10 }, () => { vi.setSystemTime(0); });",
      errors: [{ messageId: 'notSequential', data: { how: 'vi.setSystemTime()' } }],
    },
    {
      code: "vi.useFakeTimers(); test('a', () => undefined);",
      errors: [{ messageId: 'outsideTest', data: { method: 'useFakeTimers' } }],
    },
    {
      code: "test('a', ({ timers }) => { timers.tick(); });",
      options: [{ fixtures: ['timers'] }],
      errors: [{ messageId: 'notSequential' }],
    },
  ],
});
