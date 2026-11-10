import { test } from '#testing/test.ts';

import { parseSetupCommand } from './parse-setup-command.ts';

test('keeps a one-line command and drops trailing separators', ({ expect }) => {
  expect(parseSetupCommand('  npm ci && npm run build ;  ')).toStrictEqual({
    ok: true,
    value: 'npm ci && npm run build',
  });
  expect(parseSetupCommand('make deps || true')).toStrictEqual({
    ok: true,
    value: 'make deps || true',
  });
  expect(parseSetupCommand('curl -o x https://h/a#b')).toMatchObject({ ok: true });
});

test.for([
  ['', 'empty'],
  [' ; ', 'empty'],
  ['npm ci\nnpm run build', 'control-character'],
  ['npm\tci', 'control-character'],
  ['npm ci # deps', 'comment'],
  ['npm ci &', 'unfinished'],
  ['npm ci |', 'unfinished'],
  ['npm ci \\', 'unfinished'],
  ['x'.repeat(2001), 'too-long'],
] as const)('refuses %j (%s)', ([text, kind], { expect }) => {
  expect(parseSetupCommand(text)).toMatchObject({ ok: false, error: { kind } });
});
