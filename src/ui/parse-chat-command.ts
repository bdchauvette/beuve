import type { ReviewEffort } from '#contract/ipc-contract.ts';
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
  /** Findings as a chat answer, verified by a second pass unless `--no-verify` (ADR 0055). */
  | {
      readonly kind: 'review';
      readonly pathPrefixes: readonly string[];
      readonly fresh: boolean;
      readonly verify: boolean;
      readonly effort?: ReviewEffort;
    }
  /** Plain text: a question about the change for the Q&A chat (ADR 0031). */
  | { readonly kind: 'question'; readonly text: string }
  /** An unknown command or a malformed one; `message` says how to fix it. */
  | { readonly kind: 'invalid'; readonly message: string };

const efforts: ReadonlySet<string> = new Set(['low', 'medium', 'high']);
const whitespace = /\s+/u;
const paletteAndMenus = 'Use the command palette or the menus.';
/** Former preference commands, and where each is set now (ADR 0139). */
const settingCommands: ReadonlyMap<string, string> = new Map([
  ['/editor', 'Choose the editor in Settings › Editors.'],
  ['/diff', paletteAndMenus],
  ['/whitespace', paletteAndMenus],
  ['/generated', paletteAndMenus],
  ['/insights', paletteAndMenus],
  ['/order', paletteAndMenus],
  ['/sidebar', paletteAndMenus],
]);

/**
 * Parses one chat input line. Plain text is a question. Grammar: `/help` (or `/?`),
 * `/clear [queue]`, `/compact`, `/summarize` (or `/abstract`), and
 * `/review [--fresh] [--no-verify] [--effort=low|medium|high] [path-prefix…]`, options and
 * prefixes in any order, `--` ending the options. Prefixes are repository-relative (`./` and trailing `/` are
 * dropped); command names are case-insensitive. Chat commands act on the conversation or the
 * model; the commands that used to set preferences (`/editor`, `/diff`, `/whitespace`,
 * `/generated`, `/insights`, `/order`, `/sidebar`) answer with where those settings are now. Pure:
 * the drawer shows the result.
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
      if (args.length === 1 && args[0]?.toLowerCase() === 'queue') {
        return { kind: 'clear', queuedOnly: true };
      }
      return invalid('/clear takes nothing, or queue to drop only the waiting questions.');
    }
    case '/summarize':
    case '/abstract': {
      if (args.length === 0) {
        return { kind: 'summarize' };
      }
      return invalid(`${name.toLowerCase()} takes no arguments. Type /help for the commands.`);
    }
    case '/compact': {
      if (args.length === 0) {
        return { kind: 'compact' };
      }
      return invalid('/compact takes no arguments. Type /help for the commands.');
    }
    case '/review': {
      return parseReview(args);
    }
    default: {
      const where = settingCommands.get(name.toLowerCase());
      if (where !== undefined) {
        return invalid(
          `${name} sets a preference, which chat commands no longer do. ${where} Type /help for the chat commands.`,
        );
      }
      return invalid(`Unknown command ${name}. Type /help for the commands.`);
    }
  }
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
      let value: string | undefined = arg.slice('--effort='.length);
      if (arg === '--effort') {
        index += 1;
        value = args[index];
      }
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
