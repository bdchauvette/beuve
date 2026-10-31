import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import process from 'node:process';

import { z } from 'zod';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { Stopwatch } from '#x/time/stopwatch.ts';
import { timeoutSignal } from '#x/time/timeout-signal.ts';

import { buildClaudeCodeArgs } from './build-claude-code-args.ts';
import { classifyClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import { ClaudeCodeStreamReader } from './claude-code-stream-reader.ts';
import { createClaudeCodeEnvironment } from './create-claude-code-environment.ts';
import { flattenModelMessages } from './flatten-model-messages.ts';
import { jsonSchemaFrom } from './json-schema-from.ts';
import { parseClaudeCodeEvent } from './parse-claude-code-event.ts';
import { validateModelRequest } from './validate-model-request.ts';
import type {
  BaseModelRequest,
  CheckoutModelRequest,
  LanguageModel,
  ModelCapabilities,
  ModelEffort,
  ModelError,
  ModelOutput,
  ModelRequest,
  TextModelRequest,
  TextStreamEvent,
} from './language-model.ts';
import { tailOf } from '#x/text/tail-of.ts';

export interface ClaudeCodeModelOptions {
  /** The `claude` executable: a bare name looked up on `PATH`, or an absolute path. */
  readonly command?: string;
  /** Arguments before Claude Code's own, e.g. a script when `command` is a Node binary. */
  readonly leadingArgs?: readonly string[];
  /** The default model and effort; a request's own override them. */
  readonly model?: string;
  readonly effort?: ModelEffort;
  readonly maxBudgetUsd?: number;
  /** The configured model's context window, for prompt budgets. Unknown when omitted. */
  readonly contextWindowTokens?: number;
  /** Where the allow-listed environment is taken from. Defaults to `process.env`. */
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
  /** Added to the environment as is (e.g. a provider switch the user configured). */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Fail with `output-too-large` past this many bytes of stdout. Defaults to 32 MiB. */
  readonly maxOutputBytes?: number;
  /** Between SIGTERM and SIGKILL when stopping a run. Defaults to 2 s. */
  readonly killGrace?: Temporal.Duration;
  readonly logger?: Logger;
}

const defaultMaxOutputBytes = 32 * 1024 * 1024;
const stderrTailChars = 4096;

/**
 * The credential sources a run on the user's own Claude Code login reports in its init event.
 * `none` is a claude.ai (subscription or Console) login: no API key is involved. Anything else
 * (an API key, an `apiKeyHelper`) is not the user's login, which is what `--print` gives if it
 * ever defaults to `--bare` (ADR 0070), so such a run is stopped as `not-authenticated`.
 */
const loginSources = new Set(['none']);

/**
 * A {@link LanguageModel} that drives the user's installed Claude Code CLI headless (ADR 0019,
 * 0030), so the user's own Claude Code login authenticates and beuve never handles credentials.
 * Each run is one `claude --print` process: no shell, an allow-listed environment, `cwd` = the
 * worktree, the prompt on stdin, read-only tools only, its own process group (POSIX) so a timeout
 * or abort reaps every descendant, and a cap on stdout. `run` constrains the answer with
 * `--json-schema`; `runText` takes the final text and, with `onText`, streams its deltas.
 */
export function createClaudeCodeModel(options: ClaudeCodeModelOptions = {}): LanguageModel {
  const capabilities: ModelCapabilities = {
    tools: true,
    checkout: true,
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
  options: ClaudeCodeModelOptions,
): Promise<Result<ModelOutput<T>, ModelError>> {
  const schema = jsonSchemaFrom(request.outputSchema);
  if (schema === undefined) {
    return err({ kind: 'invalid-request', reason: 'the output schema has no JSON Schema form' });
  }
  const answer = await runClaudeCode(request, options, { jsonSchema: JSON.stringify(schema) });
  if (!answer.ok) {
    return answer;
  }
  const parsed = request.outputSchema.safeParse(answer.value.value);
  if (!parsed.success) {
    options.logger?.info('claude-code: output does not match the schema', {
      duration: answer.value.duration,
    });
    return err({ kind: 'invalid-output', reason: z.prettifyError(parsed.error) });
  }
  logFinished(answer.value, options);
  return ok({ ...answer.value, value: parsed.data });
}

async function runText(
  request: TextModelRequest,
  options: ClaudeCodeModelOptions,
): Promise<Result<ModelOutput<string>, ModelError>> {
  const answer = await runClaudeCode(request, options, {
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
  readonly jsonSchema?: string;
  readonly onText?: (event: TextStreamEvent) => void;
}

async function runClaudeCode(
  request: BaseModelRequest,
  options: ClaudeCodeModelOptions,
  mode: OutputMode,
): Promise<Result<ModelOutput<unknown>, ModelError>> {
  const invalid = validateModelRequest(request, mode.jsonSchema?.length ?? 0);
  if (invalid !== undefined) {
    return err(invalid);
  }
  if (request.signal?.aborted === true) {
    return err({ kind: 'cancelled' });
  }
  const { cwd } = request;
  if (cwd === undefined) {
    return err({
      kind: 'invalid-request',
      reason: 'Claude Code reads a checkout: cwd is required',
    });
  }
  const model = request.model ?? options.model;
  const effort = request.effort ?? options.effort;
  const args = buildClaudeCodeArgs({
    system: request.system,
    ...(mode.jsonSchema !== undefined && { jsonSchema: mode.jsonSchema }),
    ...(mode.onText !== undefined && { streamText: true }),
    ...(model !== undefined && { model }),
    ...(effort !== undefined && { effort }),
    ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
  });
  const command = options.command ?? 'claude';
  const stopwatch = new Stopwatch();
  options.logger?.debug('claude-code: starting', {
    command,
    cwd: request.cwd,
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    systemChars: request.system.length,
  });

  const run = await execute(
    command,
    [...(options.leadingArgs ?? []), ...args],
    { ...request, cwd },
    mode.onText,
    options,
  );
  const duration = stopwatch.elapsed();
  if (!run.ok) {
    options.logger?.info('claude-code: run failed', { duration, error: run.error.kind });
    return run;
  }
  const { outcome, model: reported } = run.value;
  const classified = classifyClaudeCodeOutcome(
    outcome,
    mode.jsonSchema === undefined ? 'text' : 'json',
  );
  if (!classified.ok) {
    options.logger?.info('claude-code: run failed', {
      duration,
      error: classified.error.kind,
      exitCode: outcome.exitCode,
    });
    return classified;
  }
  const { result } = classified.value;
  return ok({
    value: classified.value.value,
    model: reported,
    turns: result.turns,
    costUsd: result.costUsd,
    duration,
    deniedToolUses: result.deniedToolUses,
    ...(result.usage !== undefined && { usage: result.usage }),
  });
}

function logFinished(output: ModelOutput<unknown>, options: ClaudeCodeModelOptions): void {
  options.logger?.info('claude-code: run finished', {
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
  command: string,
  args: readonly string[],
  request: CheckoutModelRequest,
  onText: ((event: TextStreamEvent) => void) | undefined,
  options: ClaudeCodeModelOptions,
): Promise<Result<Execution, ModelError>> {
  const isOwnGroup = process.platform !== 'win32';
  const spawned = await spawnClaude(command, args, request.cwd, options, isOwnGroup);
  if (!spawned.ok) {
    return spawned;
  }
  const child = spawned.value;
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (isOwnGroup && child.pid !== undefined) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // The group is already gone.
    }
  };

  using stack = new DisposableStack();
  // Last out: reaps whatever the CLI left running in its group, after any other cleanup.
  stack.defer(() => {
    signalGroup('SIGKILL');
  });
  type Termination = 'timeout' | 'cancelled' | 'output-too-large' | 'wrong-credential';
  let termination: Termination | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  stack.defer(() => {
    clearTimeout(killTimer);
  });
  const terminate = (reason: Termination): void => {
    if (termination !== undefined) {
      return;
    }
    termination = reason;
    signalGroup('SIGTERM');
    killTimer = setTimeout(
      () => {
        signalGroup('SIGKILL');
      },
      (options.killGrace ?? Temporal.Duration.from({ seconds: 2 })).total('milliseconds'),
    );
  };
  const deadline = timeoutSignal(request.timeout);
  const stopped =
    request.signal === undefined ? deadline : AbortSignal.any([request.signal, deadline]);
  const listeners = stack.adopt(new AbortController(), (controller) => {
    controller.abort();
  });
  stopped.addEventListener(
    'abort',
    () => {
      terminate(stopped.reason === deadline.reason ? 'timeout' : 'cancelled');
    },
    { once: true, signal: listeners.signal },
  );

  const reader = new ClaudeCodeStreamReader({
    cwd: request.cwd,
    ...(request.onProgress !== undefined && { onProgress: request.onProgress }),
    ...(onText !== undefined && { onText }),
  });
  const onLine = (text: string): void => {
    if (termination === 'wrong-credential' || text.trim() === '') {
      return;
    }
    const event = parseClaudeCodeEvent(text);
    reader.read(event);
    if (event.kind !== 'init') {
      return;
    }
    if (event.apiKeySource !== undefined && !loginSources.has(event.apiKeySource)) {
      terminate('wrong-credential');
      return;
    }
    request.onProgress?.({ kind: 'started', model: reader.model });
  };

  let pending = '';
  let outputBytes = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > maxOutputBytes) {
      terminate('output-too-large');
      return;
    }
    const lines = (pending + chunk).split('\n');
    pending = lines.pop() ?? '';
    for (const text of lines) {
      onLine(text);
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = tailOf(stderr + chunk, stderrTailChars);
  });

  child.stdin.end(flattenModelMessages(request.messages));

  const { exitCode, signal } = await new Promise<{
    exitCode: number | undefined;
    signal: string | undefined;
  }>((resolve) => {
    child.once('close', (code, closeSignal) => {
      resolve({ exitCode: code ?? undefined, signal: closeSignal ?? undefined });
    });
  });

  switch (termination) {
    case 'timeout': {
      return err({ kind: 'timeout', timeout: request.timeout });
    }
    case 'cancelled': {
      return err({ kind: 'cancelled' });
    }
    case 'output-too-large': {
      return err({ kind: 'output-too-large', maxBytes: maxOutputBytes });
    }
    case 'wrong-credential': {
      return err({
        kind: 'not-authenticated',
        message:
          `Claude Code did not use your Claude Code login (credential source: ${reader.apiKeySource ?? 'unknown'}). ` +
          'beuve runs Claude Code with your own login only; check that `claude` works in a terminal.',
      });
    }
    case undefined: {
      break;
    }
  }
  if (pending !== '') {
    onLine(pending);
  }
  return ok({ outcome: reader.outcome({ exitCode, signal, stderr }), model: reader.model });
}

async function spawnClaude(
  command: string,
  args: readonly string[],
  cwd: string,
  options: ClaudeCodeModelOptions,
  isOwnGroup: boolean,
): Promise<Result<ChildProcessWithoutNullStreams, ModelError>> {
  const env = createClaudeCodeEnvironment(options.inheritedEnv ?? process.env, options.extraEnv);
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      detached: isOwnGroup,
    });
    child.stdin.on('error', () => {
      // EPIPE when the CLI exits before reading the prompt; its exit status says why.
    });
    const onError = (error: NodeJS.ErrnoException): void => {
      void (async (): Promise<void> => {
        if (error.code !== 'ENOENT') {
          resolve(
            err({
              kind: 'process-failed',
              exitCode: undefined,
              signal: undefined,
              stderr: error.message,
            }),
          );
        } else if (await isDirectory(cwd)) {
          resolve(err({ kind: 'not-installed', command }));
        } else {
          resolve(err({ kind: 'invalid-request', reason: 'cwd is not a directory' }));
        }
      })();
    };
    child.once('error', onError);
    child.once('spawn', () => {
      child.off('error', onError);
      child.on('error', (error) => {
        options.logger?.warn('claude-code: process error', { error });
      });
      resolve(ok(child));
    });
  });
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await stat(directory);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
