import type {
  DiffLayoutView,
  EditorId,
  ReviewEffort,
  ReviewOrderMode,
  SheetModeView,
  SidebarSideView,
} from '#contract/ipc-contract.ts';
import { normalizePathPrefix } from '#contract/normalize-path-prefix.ts';

/** What the reviewer typed into the chat drawer, parsed (ADR 0022). */
export type ChatCommand =
  | { readonly kind: 'empty' }
  | { readonly kind: 'help' }
  /** Deletes the open session's transcript (ADR 0031), or with `queue` only what waits (ADR 0057). */
  | { readonly kind: 'clear'; readonly queuedOnly: boolean }
  /** beuve's own summary of the change, from the diff alone (ADR 0056). */
  | { readonly kind: 'summarize' }
  /** Condenses the conversation so far into a summary later prompts send instead (ADR 0047). */
  | { readonly kind: 'compact' }
  /** `/editor` shows the preferred editor; `/editor zed` chooses one (ADR 0033). */
  | { readonly kind: 'editor'; readonly editorId?: EditorId }
  /** `/diff` shows the diff layout; `/diff split` or `/diff inline` sets it (ADR 0042). */
  | { readonly kind: 'diff'; readonly layout?: DiffLayoutView }
  /** `/whitespace` shows whether whitespace is ignored; `ignore` or `show` sets it. */
  | { readonly kind: 'whitespace'; readonly ignoreWhitespace?: boolean }
  /** `/generated` shows whether generated files are expanded; `show` or `hide` sets it (ADR 0052). */
  | { readonly kind: 'generated'; readonly showGenerated?: boolean }
  /** `/insights` shows whether `/review` findings annotate the diff; `show` or `hide` sets it (ADR 0061). */
  | { readonly kind: 'insights'; readonly showInsights?: boolean }
  /** `/order` shows the file order; `/order path|imports|calls` sets it (ADR 0065). */
  | { readonly kind: 'order'; readonly mode?: ReviewOrderMode }
  /** Approves running the open repository's tests for trace probes (ADR 0041). */
  | { readonly kind: 'trust' }
  /** Withdraws that approval. */
  | { readonly kind: 'untrust' }
  /** Findings as a chat answer, verified by a second pass unless `--no-verify` (ADR 0055). */
  | {
      readonly kind: 'review';
      readonly pathPrefixes: readonly string[];
      readonly fresh: boolean;
      readonly verify: boolean;
      readonly effort?: ReviewEffort;
    }
  /** `/sheets` shows where definitions open; `/sheets window|inline` sets it (ADR 0067). */
  | { readonly kind: 'sheets'; readonly mode?: SheetModeView }
  /** Puts the sidebar on one side (ADR 0044). */
  | { readonly kind: 'sidebar'; readonly side: SidebarSideView }
  /** Plain text: a question about the change for the Q&A chat (ADR 0031). */
  | { readonly kind: 'question'; readonly text: string }
  /** An unknown command or a malformed one; `message` says how to fix it. */
  | { readonly kind: 'invalid'; readonly message: string };

const efforts: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const whitespace = /\s+/u;

/**
 * Parses one chat input line. Plain text is a question. Grammar: `/help` (or `/?`),
 * `/clear [queue]`, `/compact`, `/summarize` (or `/abstract`), `/trust`, `/untrust`,
 * `/editor [zed|vscode|cursor]`, `/diff [split|inline]`, `/whitespace [ignore|show]`,
 * `/generated [show|hide]`, `/insights [show|hide]`, `/order [path|imports|calls]`,
 * `/sidebar left|right`, `/sheets [window|inline]`, and
 * `/review [--fresh] [--no-verify] [--effort=low|medium|high] [path-prefix…]`, options and
 * prefixes in any order, `--` ending the options. Prefixes are repository-relative (`./` and trailing `/` are
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
      if (args.length === 0) {
        return { kind: 'clear', queuedOnly: false };
      }
      return args.length === 1 && args[0]?.toLowerCase() === 'queue'
        ? { kind: 'clear', queuedOnly: true }
        : invalid('/clear takes nothing, or queue to drop only the waiting questions.');
    }
    case '/summarize':
    case '/abstract': {
      return args.length === 0
        ? { kind: 'summarize' }
        : invalid(`${name.toLowerCase()} takes no arguments. Type /help for the commands.`);
    }
    case '/compact': {
      return args.length === 0
        ? { kind: 'compact' }
        : invalid('/compact takes no arguments. Type /help for the commands.');
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
    case '/generated': {
      return parseGenerated(args);
    }
    case '/insights': {
      return parseInsights(args);
    }
    case '/order': {
      return parseOrder(args);
    }
    case '/review': {
      return parseReview(args);
    }
    case '/sheets': {
      const choice = args.length === 1 ? (args[0] ?? '').toLowerCase() : '';
      if (args.length === 0) {
        return { kind: 'sheets' };
      }
      return choice === 'window' || choice === 'inline'
        ? { kind: 'sheets', mode: choice }
        : invalid('/sheets takes window or inline, e.g. /sheets inline.');
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

const generatedAliases: Readonly<Record<string, boolean>> = {
  show: true,
  expand: true,
  hide: false,
  collapse: false,
};

function parseGenerated(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'generated' };
  }
  const showGenerated =
    args.length === 1 ? generatedAliases[(args[0] ?? '').toLowerCase()] : undefined;
  return showGenerated === undefined
    ? invalid('/generated takes show or hide, e.g. /generated show.')
    : { kind: 'generated', showGenerated };
}

function parseInsights(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'insights' };
  }
  const choice = args.length === 1 ? (args[0] ?? '').toLowerCase() : '';
  return choice === 'show' || choice === 'hide'
    ? { kind: 'insights', showInsights: choice === 'show' }
    : invalid('/insights takes show or hide, e.g. /insights hide.');
}

const orderModes: ReadonlySet<string> = new Set(['path', 'imports', 'calls']);

function parseOrder(args: readonly string[]): ChatCommand {
  if (args.length === 0) {
    return { kind: 'order' };
  }
  const mode = args.length === 1 ? (args[0] ?? '').toLowerCase() : '';
  return isOrderMode(mode)
    ? { kind: 'order', mode }
    : invalid('/order takes path, imports or calls, e.g. /order imports.');
}

function isOrderMode(value: string): value is ReviewOrderMode {
  return orderModes.has(value);
}

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
  let shouldVerify = true;
  let effort: ReviewEffort | undefined;
  let hasOptionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!hasOptionsEnded && arg.startsWith('-')) {
      if (arg === '--') {
        hasOptionsEnded = true;
        continue;
      }
      if (arg === '--fresh' || arg === '--no-verify') {
        isFresh ||= arg === '--fresh';
        shouldVerify &&= arg !== '--no-verify';
        continue;
      }
      if (arg !== '--effort' && !arg.startsWith('--effort=')) {
        return invalid(`/review has no option ${arg}. Type /help for its options.`);
      }
      const value = arg === '--effort' ? args[(index += 1)] : arg.slice('--effort='.length);
      if (value === undefined || !isEffort(value)) {
        return invalid('--effort takes low, medium or high, e.g. /review --effort=high.');
      }
      effort = value;
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
    verify: shouldVerify,
    ...(effort !== undefined && { effort }),
  };
}

function isEffort(value: string): value is ReviewEffort {
  return efforts.has(value);
}

function invalid(message: string): ChatCommand {
  return { kind: 'invalid', message };
}
