import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createClaudeCodeModel } from '#internal/llm/create-claude-code-model.ts';
import type { ClaudeCodeModelOptions } from '#internal/llm/create-claude-code-model.ts';
import type { LanguageModel } from '#internal/llm/language-model.ts';
import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import type { ClaudeCodeSettings } from './claude-code-settings.ts';
import { resolveClaudeCommand } from './resolve-claude-command.ts';

/** Why no model could be built: `claude` was not found (ADR 0022). */
export interface MissingClaude {
  readonly message: string;
}

/**
 * Finds the `claude` executable (ADR 0022) and builds the Claude Code adapter for one run. The
 * review and the chat share it. `effort` is passed to Claude Code when set.
 */
export async function resolveLanguageModel(
  claude: ClaudeCodeSettings,
  logger: Logger,
  effort?: 'low' | 'medium' | 'high',
): Promise<Result<LanguageModel, MissingClaude>> {
  const env = claude.env ?? process.env;
  let { command } = claude;
  if (command === undefined) {
    const resolved = await resolveClaudeCommand({
      env,
      homeDirectory: claude.homeDirectory ?? os.homedir(),
      platform: process.platform,
      isExecutable,
    });
    if (resolved.kind === 'missing') {
      return err({ message: resolved.message });
    }
    command = resolved.command;
  }
  const modelOptions: ClaudeCodeModelOptions = {
    command,
    logger,
    inheritedEnv: env,
    ...(claude.leadingArgs !== undefined && { leadingArgs: claude.leadingArgs }),
    ...(claude.model !== undefined && { model: claude.model }),
    ...(claude.killGraceMs !== undefined && { killGraceMs: claude.killGraceMs }),
    ...(effort !== undefined && { effort }),
    // A GUI app's PATH may lack the directory of the `node` an npm-installed `claude` needs.
    ...(path.isAbsolute(command) && {
      extraEnv: { PATH: withDirectory(path.dirname(command), env['PATH']) },
    }),
  };
  return ok(createClaudeCodeModel(modelOptions));
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

function withDirectory(directory: string, searchPath = ''): string {
  const entries = searchPath.split(path.delimiter).filter((entry) => entry !== '');
  return [directory, ...entries.filter((entry) => entry !== directory)].join(path.delimiter);
}
