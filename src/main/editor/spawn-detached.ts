import { spawn } from 'node:child_process';

import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

/**
 * Starts `command` with `args` directly (no shell), detached from beuve and with no stdio, and
 * resolves once it has started or failed to. Never rejects.
 */
export async function spawnDetached(
  command: string,
  args: readonly string[],
): Promise<Result<void, string>> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false });
      child.once('error', (error) => {
        resolve(err(error.message));
      });
      child.once('spawn', () => {
        child.unref();
        resolve(ok(undefined));
      });
    } catch (error: unknown) {
      resolve(err(error instanceof Error ? error.message : String(error)));
    }
  });
}
