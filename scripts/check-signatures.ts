import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { parseArgs, promisify } from 'node:util';

import { errorFrom } from '../src/x/error/error-from.ts';

import { teamIdentifierFrom } from './lib/codesign/team-identifier-from.ts';
import pinned from './node-runtime.json' with { type: 'json' };

const runFile = promisify(execFile);

await checkSignatures();

/**
 * Checks the signatures of a packaged macOS app (ADR 0048, 0085): the app's seal verifies, the
 * bundled Node's own signature verifies, and the Node is still signed by the Node.js Foundation
 * (`macTeamId` in `node-runtime.json`) rather than re-signed ad hoc. Pass
 * `--app out/mac-arm64/beuve.app`. Exits non-zero on any mismatch. The team identifier is public:
 * every copy of the binary carries it.
 */
async function checkSignatures(): Promise<void> {
  const { values } = parseArgs({ options: { app: { type: 'string' } } });
  if (values.app === undefined) {
    console.error('check-signatures: pass --app <out/mac-arm64/beuve.app>');
    process.exitCode = 1;
    return;
  }
  const app = path.resolve(values.app);
  const node = path.join(app, 'Contents/Resources/node/node');
  const failures = [
    ...(await verify(app, ['--deep', '--strict'])),
    ...(await verify(node, ['--strict'])),
    ...(await checkTeam(node)),
  ];
  await printDetails(node);
  for (const failure of failures) {
    console.error(`check-signatures: FAIL ${failure}`);
  }
  if (failures.length === 0) {
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}

async function verify(target: string, flags: readonly string[]): Promise<string[]> {
  try {
    const { stderr } = await runFile('codesign', ['--verify', ...flags, '--verbose=2', target], {
      encoding: 'utf8',
    });
    console.log(`check-signatures: ${target}: ${stderr.trim()}`);
    return [];
  } catch (error: unknown) {
    return [`${target} does not verify: ${errorFrom(error).message}`];
  }
}

async function checkTeam(node: string): Promise<string[]> {
  try {
    const { stderr } = await runFile('codesign', ['-dv', '--verbose=4', node], {
      encoding: 'utf8',
    });
    const team = teamIdentifierFrom(stderr);
    if (!team.ok) {
      return [`${node}: ${team.error}`];
    }
    if (team.value !== pinned.macTeamId) {
      return [`${node} is signed by team ${team.value}, not the pinned ${pinned.macTeamId}`];
    }
    return [];
  } catch (error: unknown) {
    return [`${node} has no readable signature: ${errorFrom(error).message}`];
  }
}

/** Informational: the signature details, the entitlements, and whether Gatekeeper would accept the binary alone. */
async function printDetails(node: string): Promise<void> {
  const commands: readonly (readonly string[])[] = [
    ['codesign', '-dv', '--verbose=4', node],
    ['codesign', '-d', '--entitlements', '-', node],
    ['spctl', '--assess', '--type', 'execute', '-vv', node],
  ];
  for (const [command, ...args] of commands) {
    if (command === undefined) {
      continue;
    }
    try {
      const { stdout, stderr } = await runFile(command, args, { encoding: 'utf8' });
      console.log(`check-signatures: ${command} ${args.join(' ')}\n${stdout}${stderr}`.trimEnd());
    } catch (error: unknown) {
      console.log(
        `check-signatures: ${command} ${args.join(' ')} (informational): ${errorFrom(error).message}`,
      );
    }
  }
}
