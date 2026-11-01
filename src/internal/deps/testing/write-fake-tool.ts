import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** How a fake package manager behaves. */
export interface FakeToolBehaviour {
  /** Paths (relative to its working directory) it creates, like `node_modules/.installed`. */
  readonly creates?: readonly string[];
  /** Its exit code. Defaults to 0. */
  readonly exitCode?: number;
  /** Printed to stdout before it exits. */
  readonly prints?: string;
  /** Waits until killed, after starting a grandchild that also waits (its pid is recorded). */
  readonly hangs?: boolean;
  /** What `--version` prints. Defaults to `1.0.0`. */
  readonly version?: string;
}

/** One run of a fake tool, as it recorded itself. */
export interface FakeToolCall {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** A written fake tool. */
export interface FakeTool {
  /** The executable: a `/bin/sh` launcher of a Node script. */
  readonly command: string;
  /** Its runs, oldest first; `--version` probes included. */
  readonly calls: () => readonly FakeToolCall[];
  /** The pids of grandchildren a hanging run started. */
  readonly grandchildren: () => readonly number[];
}

/** Where to write a fake, and the name it is run by. */
export interface FakeToolPlace {
  readonly directory: string;
  readonly name: string;
}

/**
 * Writes a fake package manager (ADR 0058: no real registry): it records its argv, working
 * directory and environment, creates what `behaviour.creates` names, prints, and exits, or
 * hangs until its process group is killed. Runs on the Node running the tests.
 */
export function writeFakeTool(
  { directory, name }: FakeToolPlace,
  behaviour: FakeToolBehaviour = {},
): FakeTool {
  const script = path.join(directory, `${name}.mjs`);
  const log = path.join(directory, `${name}.calls.jsonl`);
  const children = path.join(directory, `${name}.children`);
  const config = JSON.stringify({ log, children, behaviour });
  writeFileSync(
    script,
    fakeSource.replace('__CONFIG__', () => JSON.stringify(config)),
  );
  const command = path.join(directory, name);
  writeFileSync(command, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(command, 0o755);
  return {
    command,
    calls: (): readonly FakeToolCall[] => {
      if (!existsSync(log)) {
        return [];
      }
      return readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as FakeToolCall);
    },
    grandchildren: (): readonly number[] => {
      if (!existsSync(children)) {
        return [];
      }
      return readFileSync(children, 'utf8').trim().split('\n').map(Number);
    },
  };
}

const fakeSource = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const { log, children, behaviour } = JSON.parse(__CONFIG__);
const argv = process.argv.slice(2);
appendFileSync(log, JSON.stringify({ argv, cwd: process.cwd(), env: process.env }) + '\n');
if (argv[0] === '--version') {
  process.stdout.write((behaviour.version ?? '1.0.0') + '\n');
  process.exit(0);
}
for (const file of behaviour.creates ?? []) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'installed by ' + argv.join(' ') + '\n');
}
if (behaviour.prints !== undefined) {
  process.stdout.write(behaviour.prints);
}
if (behaviour.hangs) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  appendFileSync(children, child.pid + '\n');
  process.on('SIGTERM', () => {});
  process.stdout.write('waiting\n');
  setInterval(() => {}, 1000);
} else {
  process.exitCode = behaviour.exitCode ?? 0;
}
`;
