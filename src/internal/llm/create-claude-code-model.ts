import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { z } from 'zod';

import type { Logger } from '#pkg/logger/create-logger.ts';
import { err } from '#pkg/result/err.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { buildClaudeCodeArgs } from './build-claude-code-args.ts';
import type { ClaudeCodeEffort } from './build-claude-code-args.ts';
import { classifyClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import { createClaudeCodeEnvironment } from './create-claude-code-environment.ts';
import { parseClaudeCodeEvent } from './parse-claude-code-event.ts';
import type { ClaudeCodeResult } from './parse-claude-code-event.ts';
import type {
  BaseModelRequest,
  LanguageModel,
  ModelError,
  ModelOutput,
  ModelRequest,
  TextModelRequest,
  TextStreamEvent,
} from './language-model.ts';

export interface ClaudeCodeModelOptions {
  /** The `claude` executable: a bare name looked up on `PATH`, or an absolute path. */
  readonly command?: string;
  /** Arguments before Claude Code's own, e.g. a script when `command` is a Node binary. */
  readonly leadingArgs?: readonly string[];
  readonly model?: string;
  readonly effort?: ClaudeCodeEffort;
  readonly maxBudgetUsd?: number;
  /** Where the allow-listed environment is taken from. Defaults to `process.env`. */
  readonly inheritedEnv?: Readonly<Record<string, string | undefined>>;
  /** Added to the environment as is (e.g. a provider switch the user configured). */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Fail with `output-too-large` past this many bytes of stdout. Defaults to 32 MiB. */
  readonly maxOutputBytes?: number;
  /** Between SIGTERM and SIGKILL when stopping a run. Defaults to 2 s. */
  readonly killGraceMs?: number;
  readonly logger?: Logger;
}

const defaultMaxOutputBytes = 32 * 1024 * 1024;
const stderrTailChars = 4096;
/** Linux caps one argv string at 128 KiB; the system prompt and schema travel as arguments. */
const maxArgumentChars = 100_000;

/**
 * A {@link LanguageModel} that drives the user's installed Claude Code CLI headless (ADR 0019,
 * 0030), so the user's own Claude Code login authenticates and beuve never handles credentials.
 * Each run is one `claude --print` process: no shell, an allow-listed environment, `cwd` = the
 * worktree, the prompt on stdin, read-only tools only, its own process group (POSIX) so a timeout
 * or abort reaps every descendant, and a cap on stdout. `run` constrains the answer with
 * `--json-schema`; `runText` takes the final text and, with `onText`, streams its deltas.
 */
export function createClaudeCodeModel(options: ClaudeCodeModelOptions = {}): LanguageModel {
  return {
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
  const jsonSchema = toJsonSchema(request.outputSchema);
  if (jsonSchema === undefined) {
    return err({ kind: 'invalid-request', reason: 'the output schema has no JSON Schema form' });
  }
  const answer = await runClaudeCode(request, options, { jsonSchema });
  if (!answer.ok) {
    return answer;
  }
  const parsed = request.outputSchema.safeParse(answer.value.value);
  if (!parsed.success) {
    options.logger?.info('claude-code: output does not match the schema', {
      durationMs: answer.value.durationMs,
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
  const invalid = validateRequest(request, mode.jsonSchema ?? '');
  if (invalid !== undefined) {
    return err(invalid);
  }
  if (request.signal?.aborted === true) {
    return err({ kind: 'cancelled' });
  }
  const args = buildClaudeCodeArgs({
    system: request.system,
    ...(mode.jsonSchema !== undefined && { jsonSchema: mode.jsonSchema }),
    ...(mode.onText !== undefined && { streamText: true }),
    ...(options.model !== undefined && { model: options.model }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.maxBudgetUsd !== undefined && { maxBudgetUsd: options.maxBudgetUsd }),
  });
  const command = options.command ?? 'claude';
  const started = performance.now();
  options.logger?.debug('claude-code: starting', {
    command,
    cwd: request.cwd,
    promptChars: request.prompt.length,
    systemChars: request.system.length,
  });

  const run = await execute(
    command,
    [...(options.leadingArgs ?? []), ...args],
    request,
    mode.onText,
    options,
  );
  const durationMs = Math.round(performance.now() - started);
  if (!run.ok) {
    options.logger?.info('claude-code: run failed', { durationMs, error: run.error.kind });
    return run;
  }
  const { outcome, model } = run.value;
  const classified = classifyClaudeCodeOutcome(
    outcome,
    mode.jsonSchema === undefined ? 'text' : 'json',
  );
  if (!classified.ok) {
    options.logger?.info('claude-code: run failed', {
      durationMs,
      error: classified.error.kind,
      exitCode: outcome.exitCode,
    });
    return classified;
  }
  const { result } = classified.value;
  return ok({
    value: classified.value.value,
    model,
    turns: result.turns,
    costUsd: result.costUsd,
    durationMs,
    deniedToolUses: result.deniedToolUses,
  });
}

function logFinished(output: ModelOutput<unknown>, options: ClaudeCodeModelOptions): void {
  options.logger?.info('claude-code: run finished', {
    durationMs: output.durationMs,
    model: output.model,
    turns: output.turns,
    costUsd: output.costUsd,
    deniedToolUses: output.deniedToolUses,
  });
}

/** Without the `$schema` dialect key, which Claude Code's structured output doesn't need. */
function toJsonSchema(schema: z.ZodType): string | undefined {
  try {
    const json = Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== '$schema');
    return JSON.stringify(Object.fromEntries(json));
  } catch {
    return undefined;
  }
}

function validateRequest(request: BaseModelRequest, jsonSchema: string): ModelError | undefined {
  if (!path.isAbsolute(request.cwd)) {
    return { kind: 'invalid-request', reason: 'cwd must be absolute' };
  }
  if ([request.cwd, request.system, request.prompt].some((text) => text.includes('\0'))) {
    return { kind: 'invalid-request', reason: 'the request contains a NUL byte' };
  }
  if (request.system.length + jsonSchema.length > maxArgumentChars) {
    return { kind: 'invalid-request', reason: 'the system prompt and schema are too long' };
  }
  if (!(request.timeoutMs > 0)) {
    return { kind: 'invalid-request', reason: 'timeoutMs must be positive' };
  }
  return undefined;
}

interface Execution {
  readonly outcome: ClaudeCodeOutcome;
  readonly model: string | undefined;
}

async function execute(
  command: string,
  args: readonly string[],
  request: BaseModelRequest,
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

  type Termination = 'timeout' | 'cancelled' | 'output-too-large';
  let termination: Termination | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  const terminate = (reason: Termination): void => {
    if (termination !== undefined) {
      return;
    }
    termination = reason;
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => {
      signalGroup('SIGKILL');
    }, options.killGraceMs ?? 2000);
  };
  const timeout = setTimeout(() => {
    terminate('timeout');
  }, request.timeoutMs);
  const onAbort = (): void => {
    terminate('cancelled');
  };
  request.signal?.addEventListener('abort', onAbort, { once: true });

  let model: string | undefined;
  let result: ClaudeCodeResult | undefined;
  let rateLimit: ClaudeCodeOutcome['rateLimit'];
  let invalidLine: string | undefined;
  let hasStreamedText = false;
  const onLine = (text: string): void => {
    if (text.trim() === '') {
      return;
    }
    const event = parseClaudeCodeEvent(text);
    switch (event.kind) {
      case 'init': {
        model = event.model;
        request.onProgress?.({ kind: 'started', model });
        break;
      }
      case 'tool-use': {
        for (const tool of event.tools) {
          request.onProgress?.({ kind: 'tool-use', tool });
        }
        break;
      }
      case 'message-start': {
        if (hasStreamedText) {
          hasStreamedText = false;
          onText?.({ kind: 'reset' });
        }
        break;
      }
      case 'text-delta': {
        hasStreamedText = true;
        onText?.({ kind: 'append', text: event.text });
        break;
      }
      case 'rate-limit': {
        rateLimit = event.status === 'allowed' ? rateLimit : event;
        break;
      }
      case 'result': {
        result = event.result;
        break;
      }
      case 'invalid': {
        invalidLine ??= event.reason;
        break;
      }
      case 'other': {
        break;
      }
    }
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
    stderr = (stderr + chunk).slice(-stderrTailChars);
  });

  child.stdin.end(request.prompt);

  const { exitCode, signal } = await new Promise<{
    exitCode: number | undefined;
    signal: string | undefined;
  }>((resolve) => {
    child.once('close', (code, closeSignal) => {
      resolve({ exitCode: code ?? undefined, signal: closeSignal ?? undefined });
    });
  });
  clearTimeout(timeout);
  clearTimeout(killTimer);
  request.signal?.removeEventListener('abort', onAbort);
  signalGroup('SIGKILL');

  switch (termination) {
    case 'timeout': {
      return err({ kind: 'timeout', timeoutMs: request.timeoutMs });
    }
    case 'cancelled': {
      return err({ kind: 'cancelled' });
    }
    case 'output-too-large': {
      return err({ kind: 'output-too-large', maxBytes: maxOutputBytes });
    }
    case undefined: {
      break;
    }
  }
  if (pending !== '') {
    onLine(pending);
  }
  return ok({ outcome: { exitCode, signal, stderr, result, rateLimit, invalidLine }, model });
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
