import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';
import { noTimeNumberArithmetic } from './no-time-number-arithmetic.ts';

createTypedRuleTester().run('no-time-number-arithmetic', noTimeNumberArithmetic, {
  valid: [
    "declare const d: Temporal.Duration; setTimeout(() => undefined, d.total('milliseconds'));",
    "declare const d: Temporal.Duration; const ms = d.total('milliseconds'); setInterval(() => undefined, ms);",
    "declare const d: Temporal.Duration; const signal = AbortSignal.timeout(d.total('milliseconds'));",
    "declare const d: Temporal.Duration; declare function run(o: { timeout: number }): void; run({ timeout: d.total('milliseconds') });",
    'declare const i: Temporal.Instant; const copy = Temporal.Instant.fromEpochMilliseconds(i.epochMilliseconds);',
    'declare const i: Temporal.Instant; const copy = Temporal.Instant.fromEpochNanoseconds(i.epochNanoseconds);',
    'declare const d: Temporal.Duration; const label = `${String(d.minutes)} min ago`;',
    "declare const d: Temporal.Duration; function ms(): number { return d.total('milliseconds'); }",
    'declare const stats: { mtimeMs: number }; const at = Temporal.Instant.fromEpochMilliseconds(stats.mtimeMs);',
    'declare const raw: { seconds: number }; const ms = raw.seconds * 1000;',
    'declare const a: Temporal.Instant; declare const b: Temporal.Instant; const later = Temporal.Instant.compare(a, b) > 0;',
    {
      code: "declare const d: Temporal.Duration; declare function log(f: object): void; log({ durationMs: d.total('milliseconds') });",
      options: [{ sinkProperties: ['durationMs'] }],
    },
    {
      code: "declare const d: Temporal.Duration; declare function wait(ms: number): void; wait(d.total('milliseconds'));",
      options: [{ sinks: ['wait'] }],
    },
  ],
  invalid: [
    {
      code: 'declare const i: Temporal.Instant; const seconds = i.epochMilliseconds / 1000;',
      errors: [
        {
          messageId: 'unitArithmetic',
          data: { operator: '/', constant: '1000', source: 'Instant#epochMilliseconds' },
        },
      ],
    },
    {
      code: "declare const d: Temporal.Duration; setTimeout(() => undefined, d.total('seconds') * 1000);",
      errors: [{ messageId: 'unitArithmetic' }],
    },
    {
      code: 'declare const i: Temporal.Instant; const ms = i.epochMilliseconds; const hours = ms / (60 * 60 * 1000);',
      errors: [
        {
          messageId: 'unitArithmetic',
          data: {
            operator: '/',
            constant: '60 * 60 * 1000',
            source: 'ms from Instant#epochMilliseconds',
          },
        },
      ],
    },
    {
      code: 'const minute = 60_000; declare const d: Temporal.Duration; const n = d.milliseconds / minute;',
      errors: [
        {
          messageId: 'unitArithmetic',
          data: { operator: '/', constant: 'minute', source: 'Duration#milliseconds' },
        },
      ],
    },
    {
      code: 'declare const a: Temporal.Instant; declare const b: Temporal.Instant; const gap = b.epochMilliseconds - a.epochMilliseconds;',
      errors: [{ messageId: 'arithmetic' }, { messageId: 'arithmetic' }],
    },
    {
      code: 'declare const a: Temporal.Instant; declare const b: Temporal.Instant; const later = a.epochNanoseconds > b.epochNanoseconds;',
      errors: [{ messageId: 'comparison' }, { messageId: 'comparison' }],
    },
    {
      code: "declare const d: Temporal.Duration; const ms = Math.round(d.total('milliseconds'));",
      errors: [{ messageId: 'math', data: { name: 'round', source: 'Duration#total()' } }],
    },
    {
      code: 'const started = performance.now(); const elapsed = performance.now() - started;',
      errors: [{ messageId: 'arithmetic' }, { messageId: 'arithmetic' }],
    },
    {
      code: "declare const d: Temporal.Duration; declare function wait(ms: number): void; wait(d.total('milliseconds'));",
      errors: [
        { messageId: 'nonSinkArgument', data: { callee: 'wait', source: 'Duration#total()' } },
      ],
    },
    {
      code: "declare const d: Temporal.Duration; const options = { delayMs: d.total('milliseconds') };",
      errors: [
        { messageId: 'nonSinkProperty', data: { key: 'delayMs', source: 'Duration#total()' } },
      ],
    },
    {
      code: 'declare const d: Temporal.Duration; let n = d.seconds; n += 1;',
      errors: [{ messageId: 'arithmetic' }],
    },
  ],
});
