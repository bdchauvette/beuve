import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './create-logger.ts';

describe('createLogger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes one JSON record per call with namespace and fields', () => {
    const { records, sink } = capture();
    createLogger('git', { sink, now: fixedClock }).info('checked out', { sha: 'abc' });
    expect(records).toEqual([
      {
        time: '2026-10-28T12:00:00.000Z',
        level: 'info',
        namespace: 'git',
        message: 'checked out',
        sha: 'abc',
      },
    ]);
  });

  it('does not let fields overwrite the core keys', () => {
    const { records, sink } = capture();
    createLogger('git', { sink, now: fixedClock }).warn('real', { message: 'fake', level: 'x' });
    expect(records[0]).toMatchObject({ level: 'warn', message: 'real' });
  });

  it('drops records below the configured level', () => {
    const { records, sink } = capture();
    const logger = createLogger('x', { sink, level: 'warn' });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(records.map((record) => record['message'])).toEqual(['c', 'd']);
  });

  it('reads the level from BEUVE_LOG_LEVEL and defaults to info', () => {
    const verbose = capture();
    vi.stubEnv('BEUVE_LOG_LEVEL', 'DEBUG');
    createLogger('x', { sink: verbose.sink }).debug('shown');
    expect(verbose.records).toHaveLength(1);

    const fallback = capture();
    vi.stubEnv('BEUVE_LOG_LEVEL', 'nonsense');
    createLogger('x', { sink: fallback.sink }).debug('hidden');
    expect(fallback.records).toHaveLength(0);
  });

  it('serializes errors and bigints, and survives circular fields', () => {
    const { records, sink } = capture();
    const logger = createLogger('x', { sink, now: fixedClock });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    logger.error('failed', { error: new TypeError('bad'), count: 10n });
    logger.error('loop', { circular });

    expect(records[0]).toMatchObject({ error: { name: 'TypeError', message: 'bad' }, count: '10' });
    expect(records[1]).toMatchObject({ message: 'loop' });
    expect(typeof records[1]?.['serializationError']).toBe('string');
  });
});

function fixedClock(): Date {
  return new Date('2026-10-28T12:00:00.000Z');
}

function capture(): { records: Record<string, unknown>[]; sink: (line: string) => void } {
  const records: Record<string, unknown>[] = [];
  const sink = (line: string): void => {
    records.push(JSON.parse(line) as Record<string, unknown>);
  };
  return { records, sink };
}
