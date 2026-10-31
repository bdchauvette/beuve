import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Opens its argument for writing (creating it if missing) and prints `written` or the error code. */
function writerScript(): string {
  return `
const { openSync, writeSync, closeSync } = require('node:fs');
try {
  const fd = openSync(process.argv[1], 'w');
  writeSync(fd, 'changed\\n');
  closeSync(fd);
  process.stdout.write('written');
} catch (error) {
  process.stdout.write(String(error.code));
}
`;
}

/**
 * Tries to write `file` (replacing it, or creating it) from a separate process, as an ordinary
 * user would: `written`, or the error code, such as `EACCES`. Permission bits don't stop a
 * privileged root, so when the tests run as one (a Linux container) the writer runs under
 * `setpriv` with every capability dropped, which leaves it the same user but bound by the bits
 * like anyone else.
 */
export async function attemptWrite(file: string, signal: AbortSignal): Promise<string> {
  const node = process.execPath;
  let command = node;
  let args = ['-e', writerScript(), file];
  if (await isPrivilegedRoot()) {
    command = 'setpriv';
    args = ['--bounding-set=-all', '--inh-caps=-all', '--', node, ...args];
  }
  const { stdout } = await execFileAsync(command, args, { signal, encoding: 'utf8' });
  return stdout;
}

const effectiveCapabilities = /^CapEff:\s*([0-9a-f]+)$/mu;
const nonZeroDigit = /[^0]/u;

/** Root with capabilities, which ignores permission bits; false for every other user. */
async function isPrivilegedRoot(): Promise<boolean> {
  if (process.getuid?.() !== 0) {
    return false;
  }
  try {
    const status = await readFile('/proc/self/status', 'utf8');
    const capabilities = effectiveCapabilities.exec(status)?.[1] ?? '1';
    return nonZeroDigit.test(capabilities);
  } catch {
    return true;
  }
}
