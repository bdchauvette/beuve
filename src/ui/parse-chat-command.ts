import type { EditorId, ReviewEffort } from '#contract/ipc-contract.ts';
import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';

/** What the reviewer typed into the chat drawer, parsed (ADR 0022). */
export type ChatCommand =
  | { readonly kind: 'empty' }
  | { readonly kind: 'help' }
  /** Deletes the open session's transcript (ADR 0031). */
  | { readonly kind: 'clear' }
  /** `/editor` shows the preferred editor; `/editor zed` chooses one (ADR 0033). */
  | { readonly kind: 'editor'; readonly editorId?: EditorId }
  /** Approves running the open repository's tests for trace probes (ADR 0041). */
  | { readonly kind: 'trust' }
  /** Withdraws that approval. */
  | { readonly kind: 'untrust' }
  | {
      readonly kind: 'review';
      readonly pathPrefixes: readonly string[];
      readonly fresh: boolean;
      readonly effort?: ReviewEffort;
    }
  /** Plain text: a question about the change for the Q&A chat (ADR 0031). */
  | { readonly kind: 'question'; readonly text: string }
  /** An unknown command or a malformed one; `message` says how to fix it. */
  | { readonly kind: 'invalid'; readonly message: string };

const efforts: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const whitespace = /\s+/u;

/**
 * Parses one chat input line. Plain text is a question. Grammar: `/help` (or `/?`), `/clear`,
 * `/trust`, `/untrust`, `/editor [zed|vscode|cursor]`, and
 * `/review [--fresh] [--effort=low|medium|high] [path-prefix…]`, options and prefixes in any
 * order, `--` ending the options. Prefixes are repository-relative (`./` and trailing `/` are
 * dropped); command names are case-insensitive. Pure: the drawer shows the result.
 */
export function parseChatCommand(input: string): ChatCommand {
  const text = input.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  if (!text.startsWith('/')) {
    return { kind: 'question', text };
  }
  const [name = '', ...args] = text.split(whitespace);
  switch (name.toLowerCase()) {
    case '/help':
    case '/?': {
      return { kind: 'help' };
    }
    case '/clear': {
      return args.length === 0
        ? { kind: 'clear' }
        : invalid('/clear takes no arguments. Type /help for the commands.');
    }
    case '/trust':
    case '/untrust': {
      const kind = name.toLowerCase() === '/trust' ? 'trust' : 'untrust';
      return args.length === 0
        ? { kind }
        : invalid(`${name.toLowerCase()} takes no arguments. Type /help for the commands.`);
    }
    case '/editor': {
      return parseEditor(args);
    }
    case '/review': {
      return parseReview(args);
    }
    default: {
      return { kind: 'invalid', message: `Unknown command ${name}. Type /help for the commands.` };
    }
  }
}

const editorAliases: Readonly<Record<string, EditorId>> = {
  zed: 'zed',
  vscode: 'vscode',
  code: 'vscode',
  cursor: 'cursor',
};

function parseEditor(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'editor' };
  }
  const editorId = args.length === 1 ? editorAliases[(args[0] ?? '').toLowerCase()] : undefined;
  return editorId === undefined
    ? invalid('/editor takes zed, vscode or cursor, e.g. /editor zed.')
    : { kind: 'editor', editorId };
}

function parseReview(args: readonly string[]): ChatCommand {
  const prefixes: string[] = [];
  let isFresh = false;
  let effort: ReviewEffort | undefined;
  let hasOptionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!hasOptionsEnded && arg.startsWith('-')) {
      if (arg === '--') {
        hasOptionsEnded = true;
      } else if (arg === '--fresh') {
        isFresh = true;
      } else if (arg === '--effort' || arg.startsWith('--effort=')) {
        const value = arg === '--effort' ? args[(index += 1)] : arg.slice('--effort='.length);
        if (value === undefined || !isEffort(value)) {
          return invalid('--effort takes low, medium or high, e.g. /review --effort=high.');
        }
        effort = value;
      } else {
        return invalid(`/review has no option ${arg}. Type /help for its options.`);
      }
      continue;
    }
    const prefix = normalizePathPrefix(arg);
    if (prefix === undefined) {
      return invalid(`${arg} is not a path inside the repository.`);
    }
    if (!prefixes.includes(prefix)) {
      prefixes.push(prefix);
    }
  }
  return {
    kind: 'review',
    pathPrefixes: prefixes,
    fresh: isFresh,
    ...(effort !== undefined && { effort }),
  };
}

function isEffort(value: string): value is ReviewEffort {
  return efforts.has(value);
}

function invalid(message: string): ChatCommand {
  return { kind: 'invalid', message };
}
