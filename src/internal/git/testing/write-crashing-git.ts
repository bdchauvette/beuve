import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Writes a wrapper around the real `git` on `PATH` that forwards stdin line by line and, the
 * first `times` times a line containing `crashOn` arrives, exits with 128 before forwarding it
 * (killing its git), as a crashing `cat-file` would. Returns the `/bin/sh` launcher to use as
 * `gitBinary`. Crashes are counted in a file beside it, so restarts see the count.
 */
export function writeCrashingGit(directory: string, crashOn: string, times: number): string {
  const script = path.join(directory, 'crashing-git.mjs');
  const config = JSON.stringify({ crashOn, times, counter: path.join(directory, 'crashes') });
  writeFileSync(
    script,
    crashingSource.replace('__CONFIG__', () => JSON.stringify(config)),
  );
  const command = path.join(directory, 'crashing-git');
  writeFileSync(command, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(command, 0o755);
  return command;
}

const crashingSource = String.raw`
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { crashOn, times, counter } = JSON.parse(__CONFIG__);
const crashes = () => (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0);
const child = spawn('git', process.argv.slice(2), { stdio: ['pipe', 'inherit', 'inherit'] });
child.on('exit', (code) => process.exit(code ?? 1));
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let newline = pending.indexOf('\n');
  while (newline !== -1) {
    const line = pending.slice(0, newline + 1);
    pending = pending.slice(newline + 1);
    if (line.includes(crashOn) && crashes() < times) {
      writeFileSync(counter, String(crashes() + 1));
      child.kill('SIGKILL');
      process.exit(128);
    }
    child.stdin.write(line);
    newline = pending.indexOf('\n');
  }
});
process.stdin.on('end', () => child.stdin.end());
`;
