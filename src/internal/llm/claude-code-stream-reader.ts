import type { ClaudeCodeOutcome } from './classify-claude-code-outcome.ts';
import type { ClaudeCodeEvent, ClaudeCodeResult } from './claude-code-event-from.ts';
import { describeToolUse } from './describe-tool-use.ts';
import type { ModelProgress, TextStreamEvent } from './language-model.ts';

export interface ClaudeCodeStreamReaderOptions {
  /** The worktree, so tool descriptions show relative paths. */
  readonly cwd: string;
  readonly onProgress?: (progress: ModelProgress) => void;
  readonly onText?: (event: TextStreamEvent) => void;
}

/**
 * Follows one Claude Code run's stream-json events, for both Claude Code adapters (ADR 0030,
 * 0069, 0070): keeps the model, the credential source, the result, the latest rejected rate
 * limit and the first unparseable line, and turns the events into progress (`started`,
 * `thinking`, `tool-start`/`tool-end` with a short description, `text-start`/`text-end`) and the
 * streamed text (`append`, and `reset` when a new message starts after text was streamed).
 */
export class ClaudeCodeStreamReader {
  readonly #options: ClaudeCodeStreamReaderOptions;
  readonly #tools = new Map<string, string>();
  readonly #blocks = new Map<number, string>();
  #hasStreamedText = false;

  model: string | undefined;
  apiKeySource: string | undefined;
  version: string | undefined;
  result: ClaudeCodeResult | undefined;
  rateLimit: ClaudeCodeOutcome['rateLimit'];
  invalidLine: string | undefined;

  constructor(options: ClaudeCodeStreamReaderOptions) {
    this.#options = options;
  }

  /** Reads one event. After an `init`, the caller checks `apiKeySource` and says `started`. */
  read(event: ClaudeCodeEvent): void {
    const { onProgress, onText } = this.#options;
    switch (event.kind) {
      case 'init': {
        this.model = event.model;
        this.apiKeySource = event.apiKeySource;
        this.version = event.version;
        break;
      }
      case 'tool-use': {
        for (const use of event.uses) {
          this.#tools.set(use.id, use.tool);
          onProgress?.({
            kind: 'tool-start',
            id: use.id,
            tool: use.tool,
            description: describeToolUse(use.tool, use.input, this.#options.cwd),
          });
        }
        break;
      }
      case 'tool-result': {
        for (const { id, isError } of event.results) {
          const tool = this.#tools.get(id);
          if (tool === undefined) {
            continue;
          }

          this.#tools.delete(id);
          onProgress?.({ kind: 'tool-end', id, tool, ok: !isError });
        }
        break;
      }
      case 'message-start': {
        this.#blocks.clear();
        if (this.#hasStreamedText) {
          this.#hasStreamedText = false;
          onText?.({ kind: 'reset' });
        }
        break;
      }
      case 'block-start': {
        this.#blocks.set(event.index, event.blockType);
        if (event.blockType === 'text') {
          onProgress?.({ kind: 'text-start' });
        } else if (event.blockType === 'thinking' || event.blockType === 'redacted_thinking') {
          onProgress?.({ kind: 'thinking' });
        }
        break;
      }
      case 'block-stop': {
        if (this.#blocks.get(event.index) === 'text') {
          onProgress?.({ kind: 'text-end' });
        }
        this.#blocks.delete(event.index);
        break;
      }
      case 'refusal-fallback': {
        this.model = event.model;
        break;
      }
      case 'text-delta': {
        this.#hasStreamedText = true;
        onText?.({ kind: 'append', text: event.text });
        break;
      }
      case 'rate-limit': {
        if (event.status !== 'allowed') {
          this.rateLimit = event;
        }
        break;
      }
      case 'result': {
        this.result = event.result;
        break;
      }
      case 'invalid': {
        this.invalidLine ??= event.reason;
        break;
      }
      case 'other': {
        break;
      }
    }
  }

  /** What the run left behind, for `classifyClaudeCodeOutcome`. */
  outcome(exit: Pick<ClaudeCodeOutcome, 'exitCode' | 'signal' | 'stderr'>): ClaudeCodeOutcome {
    return {
      ...exit,
      result: this.result,
      rateLimit: this.rateLimit,
      invalidLine: this.invalidLine,
    };
  }
}
