import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** What a hold script stands in for. */
export type HoldRole =
  /**
   * A wrapper around the real `git` on `PATH`: a command whose arguments contain one of `holds`
   * (consecutive words, such as `['worktree', 'remove']`) waits for release and then runs; every
   * other command runs at once.
   */
  | { readonly kind: 'git'; readonly holds: readonly (readonly string[])[] }
  /** A smudge filter (`filter.<name>.smudge`): reads its input, waits, then writes it back. */
  | { readonly kind: 'smudge' }
  /**
   * An upload-pack (`remote.<name>.uploadpack`) that never answers: it waits until git goes away
   * (its stdin closes), then exits; a release makes it exit at once.
   */
  | { readonly kind: 'upload-pack' };

/** A written hold script. */
export interface HoldScript {
  /** The executable to configure, a `/bin/sh` launcher. */
  readonly command: string;
  /** The pids that received SIGTERM while held, oldest first. */
  readonly terminations: () => readonly string[];
}

/**
 * Writes a hold-until-signal fake to `directory` as `<name>`: each process it starts connects to
 * the {@link HoldServer} on `port` and waits there until the test releases it. On SIGTERM while
 * held it records its pid and exits with 143, as git does.
 */
export function writeHoldScript(
  directory: string,
  name: string,
  port: number,
  role: HoldRole,
): HoldScript {
  const script = path.join(directory, `${name}.mjs`);
  const marker = path.join(directory, `${name}.terminated`);
  const config = JSON.stringify({ port, role, marker });
  writeFileSync(
    script,
    holdSource.replace('__CONFIG__', () => JSON.stringify(config)),
  );
  const command = path.join(directory, name);
  writeFileSync(command, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(command, 0o755);
  return {
    command,
    terminations: (): readonly string[] => {
      if (existsSync(marker)) {
        return readFileSync(marker, 'utf8').trim().split('\n');
      }
      return [];
    },
  };
}

const holdSource = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import net from 'node:net';

const { port, role, marker } = JSON.parse(__CONFIG__);
const args = process.argv.slice(2);
const runGit = (onExit) => {
  const child = spawn('git', args, { stdio: 'inherit' });
  child.on('exit', (code) => onExit(code ?? 1));
};
const matches = (words) => args.some((_, at) => words.every((word, offset) => args[at + offset] === word));

if (role.kind === 'git' && !role.holds.some(matches)) {
  runGit((code) => process.exit(code));
} else {
  hold();
}

function hold() {
  const input = [];
  let inputEnded = false;
  let released = false;
  const socket = net.connect(port, '127.0.0.1');
  socket.setEncoding('utf8');
  socket.on('error', () => process.exit(1));
  socket.on('close', () => {
    if (!released) process.exit(1);
  });
  process.on('SIGTERM', () => {
    if (released) return;
    appendFileSync(marker, process.pid + '\n');
    socket.write('terminated\n', () => process.exit(143));
  });
  if (role.kind === 'smudge') {
    process.stdin.on('data', (chunk) => input.push(chunk));
    process.stdin.on('end', () => {
      inputEnded = true;
    });
  }
  if (role.kind === 'upload-pack') {
    process.stdin.on('end', () => process.exit(1));
    process.stdin.resume();
  }
  socket.write(JSON.stringify(args) + '\n');
  socket.on('data', (data) => {
    if (released || !data.includes('release')) return;
    released = true;
    if (role.kind === 'git') {
      runGit((code) => socket.end(() => process.exit(code)));
    } else if (role.kind === 'smudge') {
      const answer = () => process.stdout.write(Buffer.concat(input), () => socket.end(() => process.exit(0)));
      if (inputEnded) answer();
      else process.stdin.on('end', answer);
    } else {
      process.exit(1);
    }
  });
}
`;
