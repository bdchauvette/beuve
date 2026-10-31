import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';

import type { ClaudeStatusView } from '#contract/ipc-contract.ts';

import type { ClaudeCodeSettings } from './claude-code-settings.ts';
import { resolveClaudeCommand } from './resolve-claude-command.ts';

const versionTimeout = 3000;

/**
 * `claude:status` (ADR 0068): the Claude Code CLI the chat would run, found as a question would
 * find it (ADR 0022), and the first line `claude --version` prints within three seconds. It never
 * asks the model anything, so it costs no tokens and needs no login; whether the login works shows
 * on the first question.
 */
export async function readClaudeStatus(claude: ClaudeCodeSettings): Promise<ClaudeStatusView> {
  if (claude.command !== undefined) {
    const version = await readVersion(claude.command, [...(claude.leadingArgs ?? []), '--version']);
    return {
      kind: 'found',
      command: claude.command,
      source: 'configured',
      ...(version !== undefined && { version }),
    };
  }
  const resolved = await resolveClaudeCommand({
    env: claude.env ?? process.env,
    homeDirectory: claude.homeDirectory ?? os.homedir(),
    platform: process.platform,
    isExecutable,
  });
  if (resolved.kind === 'missing') {
    return resolved;
  }
  const version = await readVersion(resolved.command, ['--version']);
  return {
    kind: 'found',
    command: resolved.command,
    source: resolved.source,
    ...(version !== undefined && { version }),
  };
}

async function readVersion(command: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: versionTimeout, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const line = stdout.split('\n', 1)[0]?.trim() ?? '';
        if (error !== null || line === '') {
          resolve(undefined);
          return;
        }
        resolve(line.slice(0, 200));
      },
    );
  });
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    const stats = await stat(file);
    return stats.isFile();
  } catch {
    return false;
  }
}
