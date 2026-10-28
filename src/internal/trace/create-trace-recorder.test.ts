import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { createTraceRecorder } from './create-trace-recorder.ts';
import { defaultRecorderLimits } from './default-recorder-limits.ts';

const recorder = createTraceRecorder(defaultRecorderLimits);
const sneakyPattern = /^\{ plain: 1, computed: \[Getter\], toString: \[Function toString\]/u;
const regexp = /a+b/u;

describe('createTraceRecorder summaries', () => {
  it('renders primitives', () => {
    // eslint-disable-next-line unicorn/no-null -- null is a value the recorder must render
    const values = [undefined, null, true, 1.5, -0, NaN, 12n];
    expect(values.map((value) => preview(value))).toEqual([
      'undefined',
      'null',
      'true',
      '1.5',
      '-0',
      'NaN',
      '12n',
    ]);
    expect(preview('a"b')).toBe('"a\\"b"');
    expect(preview(Symbol('tag'))).toBe('Symbol(tag)');
    expect(recorder.summarize(12n).type).toBe('bigint');
  });

  it('bounds strings, items, depth and the whole preview', () => {
    expect(preview('x'.repeat(100))).toBe(`"${'x'.repeat(59)}…"`);
    expect(preview([1, 2, 3, 4, 5, 6, 7])).toBe('[1, 2, 3, 4, 5, … 2 more]');
    expect(preview({ a: { b: { c: 1 } } })).toBe('{ a: { b: [Object] } }');
    expect(preview([[[1]]])).toBe('[[[Array(1)]]]');
    const wide = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`key${String(index)}`, 'v'.repeat(50)]),
    );
    expect(preview(wide)).toHaveLength(defaultRecorderLimits.maxPreviewLength);
  });

  it('never runs getters, toString, toJSON or proxy traps', () => {
    let touched = 0;
    const sneaky = {
      plain: 1,
      get computed(): number {
        touched += 1;
        return 2;
      },
      toString(): string {
        touched += 1;
        return 'x';
      },
      toJSON(): string {
        touched += 1;
        return 'x';
      },
    };
    const trap = (): never => {
      touched += 1;
      throw new Error('trap');
    };
    const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap });
    expect(preview(sneaky)).toMatch(sneakyPattern);
    expect(recorder.summarize(proxy)).toEqual({ type: 'proxy', preview: '[Proxy]' });
    expect(preview({ inner: proxy })).toBe('{ inner: [Proxy] }');
    class Tagged {
      get [Symbol.toStringTag](): string {
        touched += 1;
        return 'tag';
      }
    }
    expect(preview(new Tagged())).toBe('Tagged {}');
    expect(touched).toBe(0);
  });

  it('marks cycles and renders shared references twice', () => {
    const node: { name: string; self?: unknown } = { name: 'n' };
    node.self = node;
    expect(preview(node)).toBe('{ name: "n", self: [Circular] }');
    const shared = { v: 1 };
    expect(preview([shared, shared])).toBe('[{ v: 1 }, { v: 1 }]');
  });

  it('renders built-ins through their intrinsics', () => {
    class Money {
      readonly cents = 5;
    }
    expect(preview(new Money())).toBe('Money { cents: 5 }');
    expect(preview(new Map([['a', 1]]))).toBe('Map(1) { "a" => 1 }');
    expect(preview(new Set([1, 2]))).toBe('Set(2) { 1, 2 }');
    expect(preview(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
    expect(preview(new Date(NaN))).toBe('Invalid Date');
    expect(preview(regexp)).toBe('/a+b/');
    expect(preview(new RangeError('too far'))).toBe('RangeError: too far');
    expect(preview(Promise.resolve(1))).toBe('Promise');
    expect(preview(new Uint8Array(3))).toBe('Uint8Array(3)');
    expect(preview(named)).toBe('[Function named]');
    expect(preview(Money)).toBe('[class Money]');
    expect(preview(Object.create(null))).toBe('null prototype {}');
    // eslint-disable-next-line no-sparse-arrays -- a hole must render as <empty>
    expect(preview([1, , 3])).toBe('[1, <empty>, 3]');
  });
});

describe('createTraceRecorder events', () => {
  it('attributes events to the current test and resets on take', () => {
    const fresh = createTraceRecorder(defaultRecorderLimits);
    expect(fresh.take()).toBeUndefined();
    fresh.setTest({ file: '/a.test.ts', titles: ['a'] });
    const frame = fresh.enter(0, [1]);
    expect(fresh.branch(frame, 1, 'yes')).toBe('yes');
    fresh.returns(frame, 2, 3);
    fresh.exit(frame);
    expect(fresh.take()).toEqual({
      test: { file: '/a.test.ts', titles: ['a'] },
      dropped: 0,
      events: [
        {
          kind: 'enter',
          seq: 1,
          frame: 1,
          parent: undefined,
          probe: 0,
          args: [{ type: 'number', preview: '1' }],
        },
        { kind: 'branch', seq: 2, frame: 1, probe: 1, taken: true },
        { kind: 'return', seq: 3, frame: 1, probe: 2, value: { type: 'number', preview: '3' } },
      ],
    });
    expect(fresh.take()).toBeUndefined();
  });

  it('drops events past its limits and counts them', () => {
    const small = createTraceRecorder({ ...defaultRecorderLimits, maxEventsPerProbe: 2 });
    const frame = small.enter(0, []);
    for (let index = 0; index < 5; index += 1) {
      small.branch(frame, 1, index);
    }
    small.exit(frame);
    expect(small.take()).toMatchObject({ dropped: 3 });
    const tiny = createTraceRecorder({ ...defaultRecorderLimits, maxEvents: 1 });
    tiny.exit(tiny.enter(0, []));
    expect(tiny.take()).toMatchObject({ dropped: 1, events: [{ kind: 'enter' }] });
  });

  it('tells thrown values from exceptions passing through', () => {
    const fresh = createTraceRecorder(defaultRecorderLimits);
    const error = new Error('own');
    const own = fresh.enter(0, []);
    fresh.unwind(own, fresh.throws(own, 1, error));
    fresh.exit(own);
    const passing = fresh.enter(0, []);
    fresh.unwind(passing, new Error('other'));
    fresh.exit(passing);
    const events = fresh.take()?.events.filter((event) => event.kind === 'throw');
    expect(events).toMatchObject([{ probe: 1 }, { probe: undefined }]);
  });

  it('is self-contained, so the setup module can embed its source', () => {
    const context = vm.createContext({ limits: defaultRecorderLimits });
    const summaries = vm.runInContext(
      `const recorder = (${String(createTraceRecorder)})(limits);
      const frame = recorder.enter(0, [{ list: [1, new Map([[1, 2]])] }, new Error('x')]);
      recorder.exit(frame);
      recorder.take().events[0].args.map((arg) => arg.preview);`,
      context,
    ) as unknown;
    expect(summaries).toEqual(['{ list: [1, [Map(1)]] }', 'Error: x']);
  });
});

function preview(value: unknown): string {
  return recorder.summarize(value).preview;
}

function named(): string {
  return 'named';
}
