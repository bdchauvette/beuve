/** Claude Code's `--effort` levels, as `claude --help` lists them (2.1.312). */
export type ClaudeCodeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeCodeArgsOptions {
  /** Appended to Claude Code's own system prompt. */
  readonly system: string;
  /** Serialized JSON Schema for the structured result. */
  readonly jsonSchema: string;
  /** An alias (`sonnet`, `opus`) or full model name; Claude Code's default when omitted. */
  readonly model?: string;
  readonly effort?: ClaudeCodeEffort;
  /** Claude Code stops with `error_max_budget_usd` past this estimated spend. */
  readonly maxBudgetUsd?: number;
}

/** Tools the reviewer gets: reading and searching files, nothing that writes, runs or fetches. */
const readOnlyTools = ['Read', 'Grep', 'Glob'];

/** Denied as well, in case settings or a future default would otherwise add them. */
const deniedTools = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch'];

/**
 * The argv (after the executable) for one headless, read-only Claude Code review run. Every flag
 * was checked against `claude --help` for 2.1.312 (ADR 0019). The prompt goes on stdin, so there
 * is no positional argument. Values use the `--flag=value` form: the tool flags are variadic and
 * would otherwise swallow the next argument, and a value starting with `-` can't be misread.
 */
export function buildClaudeCodeArgs(options: ClaudeCodeArgsOptions): string[] {
  return [
    '--print',
    '--output-format=stream-json',
    // Required with --print and stream-json ("requires --verbose" otherwise).
    '--verbose',
    '--input-format=text',
    '--no-session-persistence',
    // No CLAUDE.md, skills, plugins, hooks or MCP servers: the worktree is untrusted input.
    '--safe-mode',
    // No code-running tools; file tools confined to the working directory; settings files ignored.
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--permission-mode=dontAsk',
    '--permission-prompts=none',
    `--tools=${readOnlyTools.join(',')}`,
    `--allowed-tools=${readOnlyTools.join(',')}`,
    `--disallowed-tools=${deniedTools.join(',')}`,
    `--append-system-prompt=${options.system}`,
    `--json-schema=${options.jsonSchema}`,
    ...(options.model === undefined ? [] : [`--model=${options.model}`]),
    ...(options.effort === undefined ? [] : [`--effort=${options.effort}`]),
    ...(options.maxBudgetUsd === undefined
      ? []
      : [`--max-budget-usd=${String(options.maxBudgetUsd)}`]),
  ];
}
