import { mkdtempDisposable, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { classifyClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import { claudeCodeEventFrom } from './claude-code-event-from.ts';
import { ClaudeCodeStreamReader } from './claude-code-stream-reader.ts';
import { createClaudeCodeEnvironment } from './create-claude-code-environment.ts';
import { flattenModelMessages } from './flatten-model-messages.ts';
import { jsonSchemaFrom } from './json-schema-from.ts';
import type {
  BaseModelRequest,
  LanguageModel,
  ModelCapabilities,
  ModelEffort,
  ModelError,
  ModelOutput,
  ModelRequest,
  TextModelRequest,
  TextStreamEvent,
} from './language-model.ts';
import { validateModelRequest } from './validate-model-request.ts';

export interface AgentSdkModelOptions {
  /** The user's Anthropic API key. Given to Claude Code's environment only; never logged. */
  readonly apiKey: string;
  /** Defaults to `claude-opus-5-5`. */
  readonly model?: string;
  /** Sent as the API's `output_config.effort`. Defaults to `high`; a request's own wins. */
  readonly effort?: ModelEffort;
  /** The configured model's context window, for prompt budgets. Unknown when omitted. */
  readonly contextWindowTokens?: number;
  /** Claude Code stops with `error_max_turns` after this many model turns. Defaults to 100. */
  readonly maxTurns?: number;
  /** Claude Code stops with `error_max_budget_usd` past this estimated spend. */
  readonly maxBudgetUsd?: number;
  /**
   * The Claude Code binary. Defaults to the SDK's own lookup of its platform package, which only
   * works unbundled; the packaged app passes the copy in `app.asar.unpacked`.
   */
  readonly pathToClaudeCodeExecutable?: string;
  /** `ANTHROPIC_BASE_URL` for Claude Code (a gateway, or a fake API in tests). */
  readonly baseUrl?: string;
  /** Claude Code's own retries of 429, 5xx and connection errors (`CLAUDE_CODE_MAX_RETRIES`). */
  readonly maxRetries?: number;
  /** Where the allow-listed environment is taken from. Defaults to `process.env`. */
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
  readonly logger?: Logger;
}

const defaultModel = 'claude-opus-5-5';
const defaultEffort: ModelEffort = 'high';
const defaultMaxTurns = 100;
const stderrTailChars = 4096;

/** Tools the model gets: reading and searching files, nothing that writes, runs or fetches. */
const readOnlyTools = ['Read', 'Grep', 'Glob'];

/** Denied as well, in case a default or a future version would otherwise add them. */
const deniedTools = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];

/**
 * Flags the SDK has no option for, each in `claude --help` for 2.1.312: no CLAUDE.md, skills,
 * plugins, hooks or MCP servers from the worktree or the machine; no code-running tools and file
 * tools confined to the working directory; no slash commands. (`--bare` would also force API-key
 * auth, but it drops Grep and Glob, so the credential is checked from the init event instead.)
 */
const lockdownArgs: Record<string, null> = Object.fromEntries(
  // eslint-disable-next-line unicorn/no-null -- the SDK passes a flag without a value as null.
  ['safe-mode', 'restricted', 'disable-slash-commands'].map((flag) => [flag, null]),
);

/**
 * A {@link LanguageModel} on the Claude Agent SDK, authenticated with the user's Anthropic API key
 * (ADR 0069). The SDK runs its bundled Claude Code, so the harness, read-only tools and outcome
 * mapping are the CLI adapter's (ADR 0019, 0030): `Read`, `Grep` and `Glob` only, everything else
 * denied without prompting, `cwd` = the worktree, no settings sources, no MCP, no session
 * persistence. Each run gets a fresh, private `CLAUDE_CONFIG_DIR`, so no login, settings or
 * history of the user's own Claude Code is read, and a run whose init event reports any
 * credential but `ANTHROPIC_API_KEY` is stopped. `run` uses the SDK's JSON Schema output;
 * `runText` takes the result text and, with `onText`, streams its deltas.
 */
export function createAgentSdkModel(options: AgentSdkModelOptions): LanguageModel {
  const capabilities: ModelCapabilities = {
    tools: true,
    structuredOutput: 'native',
    contextWindowTokens: options.contextWindowTokens,
    streaming: true,
  };
  return {
    capabilities,
    run: async <T>(request: ModelRequest<T>): Promise<Result<ModelOutput<T>, ModelError>> =>
      runStructured(request, options),
    runText: async (request: TextModelRequest): Promise<Result<ModelOutput<string>, ModelError>> =>
      runText(request, options),
  };
}

async function runStructured<T>(
  request: ModelRequest<T>,
  options: AgentSdkModelOptions,
): Promise<Result<ModelOutput<T>, ModelError>> {
  const schema = jsonSchemaFrom(request.outputSchema);
  if (schema === undefined) {
    return err({ kind: 'invalid-request', reason: 'the output schema has no JSON Schema form' });
  }
  const answer = await runAgent(request, options, { schema });
  if (!answer.ok) {
    return answer;
  }
  const parsed = request.outputSchema.safeParse(answer.value.value);
  if (!parsed.success) {
    options.logger?.info('agent-sdk: output does not match the schema', {
      duration: answer.value.duration,
    });
    return err({ kind: 'invalid-output', reason: z.prettifyError(parsed.error) });
  }
  logFinished(answer.value, options);
  return ok({ ...answer.value, value: parsed.data });
}

async function runText(
  request: TextModelRequest,
  options: AgentSdkModelOptions,
): Promise<Result<ModelOutput<string>, ModelError>> {
  const answer = await runAgent(request, options, {
    ...(request.onText !== undefined && { onText: request.onText }),
  });
  if (!answer.ok) {
    return answer;
  }
  const { value } = answer.value;
  if (typeof value !== 'string') {
    return err({ kind: 'invalid-output', reason: 'the result has no text' });
  }
  logFinished(answer.value, options);
  return ok({ ...answer.value, value });
}

interface OutputMode {
  /** Structured output; free-form text when omitted. */
  readonly schema?: Record<string, unknown>;
  readonly onText?: (event: TextStreamEvent) => void;
}

async function runAgent(
  request: BaseModelRequest,
  options: AgentSdkModelOptions,
  mode: OutputMode,
): Promise<Result<ModelOutput<unknown>, ModelError>> {
  const invalid = validateModelRequest(
    request,
    mode.schema === undefined ? 0 : JSON.stringify(mode.schema).length,
  );
  if (invalid !== undefined) {
    return err(invalid);
  }
  if (options.apiKey.trim() === '') {
    return err({ kind: 'not-authenticated', message: 'No Anthropic API key is set.' });
  }
  if (request.signal?.aborted === true) {
    return err({ kind: 'cancelled' });
  }
  if (!(await isDirectory(request.cwd))) {
    return err({ kind: 'invalid-request', reason: 'cwd is not a directory' });
  }
  await using configDir = await mkdtempDisposable(path.join(os.tmpdir(), 'beuve-claude-'));
  const stopwatch = new Stopwatch();
  options.logger?.debug('agent-sdk: starting', {
    cwd: request.cwd,
    model: request.model ?? options.model ?? defaultModel,
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    systemChars: request.system.length,
  });
  const run = await execute(request, options, mode, configDir.path);
  const duration = stopwatch.elapsed();
  if (!run.ok) {
    options.logger?.info('agent-sdk: run failed', { duration, error: run.error.kind });
    return run;
  }
  const { outcome, model } = run.value;
  const classified = classifyClaudeCodeOutcome(
    outcome,
    mode.schema === undefined ? 'text' : 'json',
  );
  if (!classified.ok) {
    options.logger?.info('agent-sdk: run failed', { duration, error: classified.error.kind });
    return classified;
  }
  const { result } = classified.value;
  return ok({
    value: classified.value.value,
    model,
    turns: result.turns,
    costUsd: result.costUsd,
    duration,
    deniedToolUses: result.deniedToolUses,
    ...(result.usage !== undefined && { usage: result.usage }),
  });
}

function logFinished(output: ModelOutput<unknown>, options: AgentSdkModelOptions): void {
  options.logger?.info('agent-sdk: run finished', {
    duration: output.duration,
    model: output.model,
    turns: output.turns,
    costUsd: output.costUsd,
    deniedToolUses: output.deniedToolUses,
  });
}

interface Execution {
  readonly outcome: ClaudeCodeOutcome;
  readonly model: string | undefined;
}

async function execute(
  request: BaseModelRequest,
  options: AgentSdkModelOptions,
  mode: OutputMode,
  configDir: string,
): Promise<Result<Execution, ModelError>> {
  using stack = new DisposableStack();
  const controller = new AbortController();
  type Termination = 'timeout' | 'cancelled' | 'wrong-credential';
  let termination: Termination | undefined;
  const terminate = (reason: Termination): void => {
    termination ??= reason;
    controller.abort();
  };
  const deadline = timeoutSignal(request.timeout);
  const stopped =
    request.signal === undefined ? deadline : AbortSignal.any([request.signal, deadline]);
  const listeners = stack.adopt(new AbortController(), (adopted) => {
    adopted.abort();
  });
  stopped.addEventListener(
    'abort',
    () => {
      terminate(stopped.reason === deadline.reason ? 'timeout' : 'cancelled');
    },
    { once: true, signal: listeners.signal },
  );

  let stderr = '';
  let failure: unknown;
  const reader = new ClaudeCodeStreamReader({
    cwd: request.cwd,
    ...(request.onProgress !== undefined && { onProgress: request.onProgress }),
    ...(mode.onText !== undefined && { onText: mode.onText }),
  });
  let conversation: Query | undefined;
  stack.defer(() => {
    conversation?.close();
  });
  const onMessage = (message: unknown): void => {
    const event = claudeCodeEventFrom(message);
    reader.read(event);
    if (event.kind !== 'init') {
      return;
    }
    if (event.apiKeySource === 'ANTHROPIC_API_KEY') {
      request.onProgress?.({ kind: 'started', model: reader.model });
    } else {
      terminate('wrong-credential');
    }
  };
  try {
    // Throws at once, not from the iterator, when the platform's Claude Code binary is missing.
    conversation = query({
      prompt: flattenModelMessages(request.messages),
      options: sdkOptions(request, options, mode, configDir, controller, (chunk) => {
        stderr = (stderr + chunk).slice(-stderrTailChars);
      }),
    });
    for await (const message of conversation) {
      onMessage(message);
      if (termination !== undefined) {
        break;
      }
    }
  } catch (error) {
    failure = error;
  }

  switch (termination) {
    case 'timeout': {
      return err({ kind: 'timeout', timeout: request.timeout });
    }
    case 'cancelled': {
      return err({ kind: 'cancelled' });
    }
    case 'wrong-credential': {
      return err({
        kind: 'not-authenticated',
        message: `Claude Code did not authenticate with the API key (source: ${reader.apiKeySource ?? 'unknown'}).`,
      });
    }
    case undefined: {
      break;
    }
  }
  if (failure !== undefined && reader.result === undefined) {
    return err(failedToRun(failure, stderr, options));
  }
  return ok({
    outcome: reader.outcome({ exitCode: 0, signal: undefined, stderr }),
    model: reader.model,
  });
}

function sdkOptions(
  request: BaseModelRequest,
  options: AgentSdkModelOptions,
  mode: OutputMode,
  configDir: string,
  controller: AbortController,
  onStderr: (chunk: string) => void,
): Options {
  return {
    abortController: controller,
    cwd: request.cwd,
    env: createClaudeCodeEnvironment(options.inheritedEnv ?? process.env, {
      ANTHROPIC_API_KEY: options.apiKey,
      // A private config dir per run: no login, settings, history or memory of the user's own.
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'beuve',
      ...(options.baseUrl !== undefined && { ANTHROPIC_BASE_URL: options.baseUrl }),
      ...(options.maxRetries !== undefined && {
        CLAUDE_CODE_MAX_RETRIES: String(options.maxRetries),
      }),
    }),
    model: request.model ?? options.model ?? defaultModel,
    effort: request.effort ?? options.effort ?? defaultEffort,
    maxTurns: options.maxTurns ?? defaultMaxTurns,
    ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
    ...(options.pathToClaudeCodeExecutable !== undefined && {
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    }),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: request.system },
    tools: readOnlyTools,
    allowedTools: readOnlyTools,
    disallowedTools: deniedTools,
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    plugins: [],
    persistSession: false,
    // Names the session, so Claude Code makes no extra request to title it.
    title: 'beuve',
    extraArgs: lockdownArgs,
    ...(mode.schema !== undefined && {
      outputFormat: { type: 'json_schema', schema: mode.schema },
    }),
    ...(mode.onText !== undefined && { includePartialMessages: true }),
    stderr: onStderr,
  };
}

/** The SDK threw before a result: Claude Code is missing, failed to start or died. */
function failedToRun(failure: unknown, stderr: string, options: AgentSdkModelOptions): ModelError {
  const message = failure instanceof Error ? failure.message : String(failure);
  if (isMissingExecutable(message)) {
    return { kind: 'not-installed', command: options.pathToClaudeCodeExecutable ?? 'claude' };
  }
  return {
    kind: 'process-failed',
    exitCode: undefined,
    signal: undefined,
    stderr: `${message}\n${stderr}`.trim().slice(-stderrTailChars),
  };
}

/** The SDK's messages for a missing binary: "executable not found", "binary for … not found". */
function isMissingExecutable(message: string): boolean {
  return (
    message.includes('ENOENT') ||
    message.includes('executable not found') ||
    (message.includes('binary') && message.includes('not found'))
  );
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
