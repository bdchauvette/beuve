import { realpath } from 'node:fs/promises';

import { test } from '#testing/test.ts';
import type { PtyExit } from '#internal/terminal/pty-process.ts';

import { spawnNodePty } from './spawn-node-pty.ts';

test('runs a real shell on a pseudo-terminal: input, output, size and exit', async ({
  expect,
  tempDir,
}) => {
  const { promise: exited, resolve } = Promise.withResolvers<PtyExit>();
  const shell = await spawnNodePty({
    file: '/bin/sh',
    args: ['-c', 'printf "dir:%s\\n" "$PWD"; read line; printf "got:%s\\n" "$line"; stty size'],
    cwd: tempDir,
    env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color' },
    size: { cols: 90, rows: 20 },
  });
  let output = '';
  shell.onData((data) => {
    output += data;
  });
  shell.onExit(resolve);
  shell.resize({ cols: 100, rows: 31 });
  shell.write('hello\r');
  const exit = await exited;
  expect(exit.exitCode).toBe(0);
  expect(output).toContain(`dir:${await realpath(tempDir)}`);
  expect(output).toContain('got:hello');
  expect(output).toContain('31 100');
});
