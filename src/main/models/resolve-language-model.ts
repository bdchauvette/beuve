import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import type { ModelRole } from '#contract/ipc-contract.ts';
import { createAgentSdkModel } from '#internal/llm/create-agent-sdk-model.ts';
import { createClaudeCodeModel } from '#internal/llm/create-claude-code-model.ts';
import type { ClaudeCodeModelOptions } from '#internal/llm/create-claude-code-model.ts';
import { createOpenAiCompatibleModel } from '#internal/llm/create-open-ai-compatible-model.ts';
import type { LanguageModel, ModelError } from '#internal/llm/language-model.ts';
import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { ClaudeCodeSettings } from '../chat/claude-code-settings.ts';
import { resolveClaudeCommand } from '../chat/resolve-claude-command.ts';
import { checkClaudeCodeVersion } from './check-claude-code-version.ts';
import type { ClaudeCodeVersionCheck } from './create-claude-code-version-check.ts';
import type { ModelRegistryStore } from './create-model-registry-store.ts';
import type { SecretStore } from './create-secret-store.ts';
import type { ModelEntry } from './model-registry.ts';

/** What {@link resolveLanguageModel} builds adapters from. */
export interface ModelResolverDeps {
  readonly registry: ModelRegistryStore;
  readonly secrets: SecretStore;
  /** How the CLI entry finds and runs `claude` (ADR 0022); tests pass the fake. */
  readonly claude: ClaudeCodeSettings;
  /** The Claude Code binary packaged with beuve, for an Agent SDK entry set to Bundled. */
  readonly bundledClaudeCodePath?: string;
  /** Development and test settings for the Agent SDK adapter (a fake Messages API). */
  readonly agentSdk?: {
    readonly baseUrl?: string;
    readonly maxRetries?: number;
    readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
  };
  readonly logger: Logger;
  /**
   * Checks an installed `claude` for the Agent SDK; main passes one that remembers the answer per
   * executable (`createClaudeCodeVersionCheck`). Defaults to checking on every request.
   */
  readonly checkClaudeCodeVersion?: ClaudeCodeVersionCheck;
}

/** A built adapter, the entry it came from, and the name progress lines give it. */
export interface ResolvedModel {
  readonly model: LanguageModel;
  readonly entry: ModelEntry;
  /** `Claude Code` for both Claude Code kinds, else the entry's label. */
  readonly name: string;
}

/**
 * When a server's context window is not configured, prompts are sized for a small local model
 * (ADR 0071): Ollama's default context is smaller still unless `num_ctx` is raised.
 */
const defaultOpenAiContextWindow = 32_768;

/**
 * Builds the adapter for a role, or for one registry entry (Settings' Test), per request
 * (ADR 0070): the entry's kind picks the adapter, its settings and capabilities configure it,
 * and its key comes from the secret store. A Claude Code CLI entry finds `claude` as the chat
 * always has (ADR 0022). An Agent SDK entry runs the bundled binary, or the installed `claude`
 * (its path, or found the same way) after checking it is at least the SDK's pinned version
 * (once per executable when `deps.checkClaudeCodeVersion` caches).
 * Expected failures are the model port's errors, so the chat reports them like a run's.
 */
export async function resolveLanguageModel(
  target: { readonly role: ModelRole } | { readonly entryId: string },
  deps: ModelResolverDeps,
): Promise<Result<ResolvedModel, ModelError>> {
  const registry = await deps.registry.read();
  const id = 'role' in target ? registry.roles[target.role] : target.entryId;
  const entry = registry.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    return err({ kind: 'invalid-request', reason: `no model named ${id}` });
  }
  switch (entry.kind) {
    case 'claude-code-cli': {
      const command = await claudeCommand(deps.claude, undefined);
      if (command.ok) {
        return ok({ model: cliModel(entry, command.value, deps), entry, name: 'Claude Code' });
      }
      return command;
    }
    case 'claude-agent-sdk': {
      const apiKey =
        entry.apiKeyRef === undefined ? undefined : await deps.secrets.get(entry.apiKeyRef);
      let executable: string | undefined = deps.bundledClaudeCodePath;
      if (entry.executable.source === 'installed') {
        const command = await claudeCommand(deps.claude, entry.executable.path);
        if (!command.ok) {
          return command;
        }
        const check = deps.checkClaudeCodeVersion ?? checkClaudeCodeVersion;
        const version = await check(command.value, deps.claude.leadingArgs);
        if (!version.ok) {
          return version;
        }
        executable = command.value;
      }
      return ok({
        model: createAgentSdkModel({
          apiKey: apiKey ?? '',
          logger: deps.logger,
          ...(entry.model !== undefined && { model: entry.model }),
          ...(entry.effort !== undefined && { effort: entry.effort }),
          ...(entry.contextWindowTokens !== undefined && {
            contextWindowTokens: entry.contextWindowTokens,
          }),
          ...(executable !== undefined && { pathToClaudeCodeExecutable: executable }),
          ...(deps.agentSdk?.baseUrl !== undefined && { baseUrl: deps.agentSdk.baseUrl }),
          ...(deps.agentSdk?.maxRetries !== undefined && { maxRetries: deps.agentSdk.maxRetries }),
          ...(deps.agentSdk?.inheritedEnv !== undefined && {
            inheritedEnv: deps.agentSdk.inheritedEnv,
          }),
        }),
        entry,
        name: 'Claude Code',
      });
    }
    case 'openai-compatible': {
      const apiKey =
        entry.apiKeyRef === undefined ? undefined : await deps.secrets.get(entry.apiKeyRef);
      return ok({
        model: createOpenAiCompatibleModel({
          baseUrl: entry.baseUrl,
          model: entry.model,
          tools: entry.tools,
          contextWindowTokens: entry.contextWindowTokens ?? defaultOpenAiContextWindow,
          logger: deps.logger,
          ...(apiKey !== undefined && { apiKey }),
          ...(entry.effort !== undefined && { effort: entry.effort }),
        }),
        entry,
        name: entry.label,
      });
    }
  }
}

function cliModel(
  entry: ModelEntry & { kind: 'claude-code-cli' },
  command: string,
  deps: ModelResolverDeps,
): LanguageModel {
  const { claude } = deps;
  const env = claude.env ?? process.env;
  const model = entry.model ?? claude.model;
  const options: ClaudeCodeModelOptions = {
    command,
    logger: deps.logger,
    inheritedEnv: env,
    ...(claude.leadingArgs !== undefined && { leadingArgs: claude.leadingArgs }),
    ...(model !== undefined && { model }),
    ...(entry.effort !== undefined && { effort: entry.effort }),
    ...(entry.contextWindowTokens !== undefined && {
      contextWindowTokens: entry.contextWindowTokens,
    }),
    ...(claude.killGrace !== undefined && { killGrace: claude.killGrace }),
    // A GUI app's PATH may lack the directory of the `node` an npm-installed `claude` needs.
    ...(path.isAbsolute(command) && {
      extraEnv: { PATH: withDirectory(path.dirname(command), env['PATH']) },
    }),
  };
  return createClaudeCodeModel(options);
}

/** `configured` if given and executable, else the fixed test command, else the usual lookup. */
async function claudeCommand(
  claude: ClaudeCodeSettings,
  configured: string | undefined,
): Promise<Result<string, ModelError>> {
  if (configured !== undefined) {
    if (await isExecutable(configured)) {
      return ok(configured);
    }
    return err({ kind: 'not-installed', command: configured });
  }
  if (claude.command !== undefined) {
    return ok(claude.command);
  }
  const resolved = await resolveClaudeCommand({
    env: claude.env ?? process.env,
    homeDirectory: claude.homeDirectory ?? os.homedir(),
    platform: process.platform,
    isExecutable,
  });
  if (resolved.kind === 'found') {
    return ok(resolved.command);
  }
  return err({ kind: 'not-installed', command: 'claude' });
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
