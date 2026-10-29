import type {
  DiffLayoutView,
  EditorId,
  ReviewEffort,
  SidebarSideView,
} from '#contract/ipc-contract.ts';
import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';

/** What the reviewer typed into the chat drawer, parsed (ADR 0022). */
export type ChatCommand =
  | { readonly kind: 'empty' }
  | { readonly kind: 'help' }
  /** Deletes the open session's transcript (ADR 0031). */
  | { readonly kind: 'clear' }
  /** `/editor` shows the preferred editor; `/editor zed` chooses one (ADR 0033). */
  | { readonly kind: 'editor'; readonly editorId?: EditorId }
  /** `/diff` shows the diff layout; `/diff split` or `/diff inline` sets it (ADR 0042). */
  | { readonly kind: 'diff'; readonly layout?: DiffLayoutView }
  /** `/whitespace` shows whether whitespace is ignored; `ignore` or `show` sets it. */
  | { readonly kind: 'whitespace'; readonly ignoreWhitespace?: boolean }
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
  /** Puts the sidebar on one side (ADR 0044). */
  | { readonly kind: 'sidebar'; readonly side: SidebarSideView }
  /** Plain text: a question about the change for the Q&A chat (ADR 0031). */
  | { readonly kind: 'question'; readonly text: string }
  /** An unknown command or a malformed one; `message` says how to fix it. */
  | { readonly kind: 'invalid'; readonly message: string };

const efforts: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const whitespace = /\s+/u;

/**
 * Parses one chat input line. Plain text is a question. Grammar: `/help` (or `/?`), `/clear`,
 * `/trust`, `/untrust`, `/editor [zed|vscode|cursor]`, `/diff [split|inline]`,
 * `/whitespace [ignore|show]`, `/sidebar left|right`, and
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
    case '/diff': {
      return parseDiff(args);
    }
    case '/whitespace': {
      return parseWhitespace(args);
    }
    case '/review': {
      return parseReview(args);
    }
    case '/sidebar': {
      const [side] = args;
      return args.length === 1 && (side === 'left' || side === 'right')
        ? { kind: 'sidebar', side }
        : invalid('/sidebar takes left or right.');
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

const layoutAliases: Readonly<Record<string, DiffLayoutView>> = {
  split: 'split',
  'side-by-side': 'split',
  inline: 'unified',
  unified: 'unified',
};

function parseDiff(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'diff' };
  }
  const layout = args.length === 1 ? layoutAliases[(args[0] ?? '').toLowerCase()] : undefined;
  return layout === undefined
    ? invalid('/diff takes split or inline, e.g. /diff inline.')
    : { kind: 'diff', layout };
}

const whitespaceAliases: Readonly<Record<string, boolean>> = {
  ignore: true,
  hide: true,
  show: false,
};

function parseWhitespace(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'whitespace' };
  }
  const ignore = args.length === 1 ? whitespaceAliases[(args[0] ?? '').toLowerCase()] : undefined;
  return ignore === undefined
    ? invalid('/whitespace takes ignore or show, e.g. /whitespace ignore.')
    : { kind: 'whitespace', ignoreWhitespace: ignore };
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
