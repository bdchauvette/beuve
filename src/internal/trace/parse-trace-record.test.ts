import { describe, expect, it } from 'vitest';

import { parseTraceRecord } from './parse-trace-record.ts';

describe('parseTraceRecord', () => {
  it('reads what the recorder writes', () => {
    const record = {
      test: { file: '/w/a.test.ts', titles: ['a', 'b'] },
      dropped: 1,
      events: [
        { kind: 'enter', seq: 1, frame: 1, probe: 0, args: [{ type: 'number', preview: '1' }] },
        { kind: 'loop', seq: 2, frame: 1, probe: 2, iterations: 3 },
        { kind: 'return', seq: 3, frame: 1, value: { type: 'string', preview: '"x"' } },
      ],
    };
    expect(parseTraceRecord(JSON.stringify(record))).toEqual({
      test: record.test,
      dropped: 1,
      events: [
        {
          kind: 'enter',
          seq: 1,
          frame: 1,
          parent: undefined,
          probe: 0,
          args: [{ type: 'number', preview: '1' }],
        },
        { kind: 'loop', seq: 2, frame: 1, probe: 2, iterations: 3 },
        {
          kind: 'return',
          seq: 3,
          frame: 1,
          probe: undefined,
          value: { type: 'string', preview: '"x"' },
        },
      ],
    });
  });

  it('rejects malformed lines and skips malformed events', () => {
    expect(parseTraceRecord('not json')).toBeUndefined();
    expect(parseTraceRecord('{"events":3}')).toBeUndefined();
    expect(parseTraceRecord('{"test":{"file":1},"events":[]}')).toBeUndefined();
    const parsed = parseTraceRecord(
      JSON.stringify({
        events: [
          { kind: 'branch', seq: -1, frame: 1, probe: 1, taken: true },
          { kind: 'branch', seq: 1, frame: 1, probe: 1, taken: 'yes' },
          { kind: 'evil', seq: 1, frame: 1 },
          {
            kind: 'value',
            seq: 2,
            frame: 1,
            probe: 1,
            value: { type: 'weird', preview: 'x'.repeat(2000) },
          },
        ],
      }),
    );
    expect(parsed?.test).toBeUndefined();
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events[0]).toMatchObject({ value: { type: 'unavailable' } });
    const event = parsed?.events[0];
    expect(event?.kind === 'value' ? event.value.preview : '').toHaveLength(1001);
  });
});
