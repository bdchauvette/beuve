import { execFile } from 'node:child_process';

import type { ModelError } from '#internal/llm/language-model.ts';
import { pinnedClaudeCodeVersion } from '#internal/llm/pinned-claude-code-version.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

const versionPattern = /(\d+)\.(\d+)\.(\d+)/u;

/**
 * Runs `<command> --version` (five seconds at most, no shell) and checks the installed Claude
 * Code against the version the pinned Agent SDK speaks (ADR 0070): older is
 * `unsupported-version`, a command that doesn't answer with a version is `not-installed`. Gives
 * the version it found. `leadingArgs` come first (a script, when `command` is Node in tests).
 */
export async function checkClaudeCodeVersion(
  command: string,
  leadingArgs: readonly string[] = [],
): Promise<Result<string, ModelError>> {
  const output = await new Promise<string | undefined>((resolve) => {
    execFile(
      command,
      [...leadingArgs, '--version'],
      { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024, shell: false },
      (error, stdout) => {
        resolve(error === null ? stdout : undefined);
      },
    );
  });
  const found = output === undefined ? undefined : versionPattern.exec(output);
  if (found === undefined || found === null) {
    return err({ kind: 'not-installed', command });
  }
  const version = found[0];
  return isAtLeast(version, pinnedClaudeCodeVersion)
    ? ok(version)
    : err({ kind: 'unsupported-version', command, version, required: pinnedClaudeCodeVersion });
}

function isAtLeast(version: string, required: string): boolean {
  const left = version.split('.').map(Number);
  const right = required.split('.').map(Number);
  for (const [index, part] of right.entries()) {
    const have = left[index] ?? 0;
    if (have !== part) {
      return have > part;
    }
  }
  return true;
}
