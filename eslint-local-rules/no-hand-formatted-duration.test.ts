import { createRuleTester } from './create-rule-tester.ts';
import { noHandFormattedDuration } from './no-hand-formatted-duration.ts';

createRuleTester().run('no-hand-formatted-duration', noHandFormattedDuration, {
  valid: [
    'const text = formatDuration(duration);',
    // Not a time number.
    'const text = (characters / 1024).toFixed(1);',
    'const text = confidence.toFixed(2);',
    'const text = (bytes / 1024 / 1024).toFixed(1);',
    // A time number that is not formatted with toFixed.
    "const wait = interval.total('milliseconds');",
    'const text = String(elapsedMs);',
    // `Ms` must end the name, not sit inside it.
    'const text = items.toFixed(1);',
    'const text = (programs / 2).toFixed(1);',
  ],
  invalid: [
    {
      code: "const text = `${duration.total('seconds').toFixed(1)} s`;",
      errors: [{ messageId: 'handFormatted', data: { source: '`duration.total(…)`' } }],
    },
    {
      code: "const text = (duration.total('milliseconds') / 1000).toFixed(1);",
      errors: [{ messageId: 'handFormatted', data: { source: '`duration.total(…)`' } }],
    },
    {
      code: 'const text = `${(view.elapsedMs / 1000).toFixed(1)} s`;',
      errors: [{ messageId: 'handFormatted', data: { source: '`elapsedMs`' } }],
    },
    {
      code: 'const text = (timeoutSeconds * 2).toFixed(0);',
      errors: [{ messageId: 'handFormatted', data: { source: '`timeoutSeconds`' } }],
    },
    {
      code: 'const text = durationMs.toFixed(0);',
      errors: [{ messageId: 'handFormatted', data: { source: '`durationMs`' } }],
    },
    {
      code: "const text = result?.duration?.total('seconds')?.toFixed(1);",
      errors: [{ messageId: 'handFormatted', data: { source: '`duration.total(…)`' } }],
    },
  ],
});
