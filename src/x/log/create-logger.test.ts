import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { createLogger } from './create-logger.ts';

describe('createLogger', () => {
  test(
    'writes one JSON record per call with namespace and fields',
    { concurrent: false },
    ({ expect, clock }) => {
      clock.set('2026-10-28T12:00:00Z');
      const { records, sink } = capture();
      createLogger('git', { sink }).info('checked out', { sha: 'abc' });
      expect(records).toStrictEqual([
        {
          time: '2026-10-28T12:00:00.000Z',
          level: 'info',
          namespace: 'git',
          message: 'checked out',
          sha: 'abc',
        },
      ]);
    },
  );

  test('does not let fields overwrite the core keys', ({ expect }) => {
    const { records, sink } = capture();
    createLogger('git', { sink }).warn('real', { message: 'fake', level: 'x' });
    expect(records[0]).toMatchObject({ level: 'warn', message: 'real' });
  });

  test('drops records below the configured level', ({ expect }) => {
    const { records, sink } = capture();
    const logger = createLogger('x', { sink, level: 'warn' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(records.map((record) => record['message'])).toStrictEqual(['c', 'd']);
  });

  test('reads the level from BEUVE_LOG_LEVEL', ({ expect }) => {
    const { records, sink } = capture();
    const env = { BEUVE_LOG_LEVEL: 'DEBUG' };
    createLogger('x', { sink, env }).debug('shown');
    expect(records).toHaveLength(1);
  });

  test('defaults to info when BEUVE_LOG_LEVEL is unset or unknown', ({ expect }) => {
    const { records, sink } = capture();
    createLogger('x', { sink, env: { BEUVE_LOG_LEVEL: 'nonsense' } }).debug('hidden');
    createLogger('x', { sink, env: {} }).debug('hidden');
    createLogger('x', { sink, env: {} }).info('shown');
    expect(records.map((record) => record['message'])).toStrictEqual(['shown']);
  });

  test('serializes errors and bigints, and survives circular fields', ({ expect }) => {
    const { records, sink } = capture();
    const logger = createLogger('x', { sink });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    logger.error('failed', { error: new TypeError('bad'), count: 10n });
    logger.error('loop', { circular });

    expect(records[0]).toMatchObject({ error: { name: 'TypeError', message: 'bad' }, count: '10' });
    expect(records[1]).toMatchObject({ message: 'loop' });
    expect(typeof records[1]?.['serializationError']).toBe('string');
  });
});

function capture(): { records: Record<string, unknown>[]; sink: (line: string) => void } {
  const records: Record<string, unknown>[] = [];
  const sink = (line: string): void => {
    records.push(JSON.parse(line) as Record<string, unknown>);
  };
  return { records, sink };
}
