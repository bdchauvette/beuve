import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ShellEnvironmentError } from './shell-environment-error.ts';

/** What a login shell printed, and the marker that brackets its environment in it. */
export interface PrintedEnvironment {
  readonly output: string;
  readonly marker: string;
}

/**
 * The variables a login shell printed between two markers (start-up files may print anything
 * before and after, such as a banner), as `JSON.stringify(process.env)`. Values that are not
 * strings are dropped. Pure.
 */
export function parseShellEnvironment({
  output,
  marker,
}: PrintedEnvironment): Result<Record<string, string>, ShellEnvironmentError> {
  const start = output.indexOf(marker);
  const end = output.lastIndexOf(marker);
  if (start === -1 || end === start) {
    return err({ kind: 'unreadable', reason: 'the shell did not print its environment' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start + marker.length, end));
  } catch {
    return err({ kind: 'unreadable', reason: 'the shell printed an environment that is not JSON' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err({
      kind: 'unreadable',
      reason: 'the shell printed an environment of the wrong shape',
    });
  }
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      variables[name] = value;
    }
  }
  return ok(variables);
}
