import { test } from '#testing/test.ts';

import { terminalShellFrom } from './terminal-shell-from.ts';

test('runs $SHELL as a login shell', ({ expect }) => {
  expect(terminalShellFrom({ shell: '/bin/fish', platform: 'linux' })).toStrictEqual({
    file: '/bin/fish',
    args: ['-l'],
  });
});

test('falls back to zsh on macOS and sh elsewhere', ({ expect }) => {
  expect(terminalShellFrom({ shell: undefined, platform: 'darwin' }).file).toBe('/bin/zsh');
  expect(terminalShellFrom({ shell: undefined, platform: 'linux' }).file).toBe('/bin/sh');
});

test('ignores a $SHELL that is not an absolute path', ({ expect }) => {
  expect(terminalShellFrom({ shell: 'zsh', platform: 'linux' }).file).toBe('/bin/sh');
  expect(terminalShellFrom({ shell: '  ', platform: 'darwin' }).file).toBe('/bin/zsh');
});
