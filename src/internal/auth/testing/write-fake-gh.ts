import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** What the fake `gh` does; written as JSON to the file passed as its first argument. */
export interface FakeGhScenario {
  /** Hosts gh is logged in to. */
  readonly hosts: Readonly<Record<string, { readonly token: string; readonly login: string }>>;
  /** Behave like a gh without `auth status --json`. */
  readonly withoutStatusJson?: boolean;
  /** Never exit. */
  readonly hang?: boolean;
  /** Exit 1 with this on stderr. */
  readonly fail?: string;
  /** Each invocation appends `{ args, envKeys, cwd }` as one JSON line here. */
  readonly callsFile: string;
}

/**
 * Writes a scripted stand-in for the `gh` CLI (plain JavaScript, run with `process.execPath`
 * and the scenario file as its first argument) into `directory` and returns its path. Its messages
 * are the ones gh 2.89 prints: `no oauth token found for <host>` (exit 1) from `auth token`, and
 * `auth status --json hosts` output with `state`, `active`, `host`, `login`, `tokenSource`, `scopes`.
 */
export function writeFakeGh(directory: string): string {
  const file = path.join(directory, 'fake-gh.mjs');
  writeFileSync(file, source);
  return file;
}

const source = String.raw`
import { appendFileSync, readFileSync } from 'node:fs';

const [scenarioFile, ...args] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));
appendFileSync(scenario.callsFile,
  JSON.stringify({ args, envKeys: Object.keys(process.env).sort(), cwd: process.cwd() }) + '\n');

const flag = (name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
const host = flag('--hostname') ?? 'github.com';
const account = scenario.hosts[host];

if (scenario.hang) {
  setInterval(() => {}, 1000);
} else if (scenario.fail !== undefined) {
  process.stderr.write(scenario.fail + '\n');
  process.exitCode = 1;
} else if (args[0] === 'auth' && args[1] === 'token') {
  if (account === undefined) {
    process.stderr.write('no oauth token found for ' + host + '\n');
    process.exitCode = 1;
  } else {
    process.stdout.write(account.token + '\n');
  }
} else if (args[0] === 'auth' && args[1] === 'status') {
  if (scenario.withoutStatusJson && args.includes('--json')) {
    process.stderr.write('unknown flag: --json\n\nUsage:  gh auth status [flags]\n');
    process.exitCode = 1;
  } else if (account === undefined) {
    process.stderr.write('You are not logged into any accounts on ' + host + '\n');
    process.stdout.write(JSON.stringify({ hosts: {} }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ hosts: { [host]: [{ state: 'success', active: true,
      host, login: account.login, tokenSource: 'keyring', scopes: 'gist, read:org, repo',
      gitProtocol: 'https' }] } }) + '\n');
  }
} else {
  process.stderr.write('unknown command\n');
  process.exitCode = 1;
}
`;
