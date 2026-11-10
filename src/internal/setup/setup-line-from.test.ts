import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { test } from '#testing/test.ts';

import { setupLineFrom } from './setup-line-from.ts';

/** What `/bin/sh` prints for the typed line, without its carriage return. */
async function shellOutput(text: string, signal: AbortSignal): Promise<string> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run('/bin/sh', ['-c', text.replace(/\r$/u, '')], { signal });
    return stdout;
  } catch (error: unknown) {
    const { stdout = '' } = error as { readonly stdout?: string };
    return stdout;
  }
}

test('groups the command and prints the marker only after it succeeds', async ({
  expect,
  signal,
}) => {
  const succeeded = setupLineFrom({
    command: 'echo one; echo two',
    shell: '/bin/zsh',
    nonce: 'ab',
  });
  expect(succeeded.text).toBe(
    String.raw`{ echo one; echo two; } && printf '\033]7703;beuve-setup;ab\007'` + '\r',
  );
  expect(succeeded.text).not.toContain(succeeded.marker);
  await expect(shellOutput(succeeded.text, signal)).resolves.toBe(`one\ntwo\n${succeeded.marker}`);
  const failed = setupLineFrom({ command: 'true; false', shell: '/bin/sh', nonce: 'ab' });
  await expect(shellOutput(failed.text, signal)).resolves.not.toContain(failed.marker);
});

test('uses begin and end for fish', ({ expect }) => {
  const line = setupLineFrom({ command: 'npm ci', shell: '/opt/homebrew/bin/fish', nonce: 'cd' });
  expect(line.text).toBe(
    String.raw`begin; npm ci; end; and printf '\033]7703;beuve-setup;cd\007'` + '\r',
  );
  expect(line.marker).toBe('\u{1B}]7703;beuve-setup;cd\u{7}');
});
