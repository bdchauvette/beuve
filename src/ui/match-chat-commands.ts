import { commandRegistry } from './command-registry.ts';

/** One chat command the input can complete to (ADR 0127). */
export interface ChatCommandSuggestion {
  /** What choosing it types into the input. */
  readonly text: string;
  /** What the list shows: `text`, or the usage when the reviewer still has to finish it. */
  readonly label: string;
  /** The `/help` line after the usage. */
  readonly description: string;
  /** Whether `text` runs as it is; `/review ` still wants its path prefixes. */
  readonly isComplete: boolean;
}

/**
 * The chat commands `input` could be the start of, for the input's completion list (ADR 0127):
 * the Chat menu's commands (`/summarize`, `/review`, …) first, then the display ones, each group
 * in `/help` order. Read from the command registry's usages, as `/help` is: an alternative
 * (`split|inline`, `--effort=low|medium|high`) is offered once per choice, and a placeholder
 * (`<path-prefix>…`) is left for the reviewer to type. Empty unless `input` starts with `/`, and
 * when the only match is what is already typed. Case-insensitive. Pure.
 */
export function matchChatCommands(input: string): readonly ChatCommandSuggestion[] {
  if (!input.startsWith('/')) {
    return [];
  }
  const query = input.toLowerCase();
  const matches = suggestions.filter((suggestion) => {
    return suggestion.text.toLowerCase().startsWith(query);
  });
  const [only] = matches;
  if (matches.length === 1 && only?.text.toLowerCase() === query) {
    return [];
  }
  return matches;
}

const suggestions: readonly ChatCommandSuggestion[] = Object.freeze(registeredSuggestions());

function registeredSuggestions(): ChatCommandSuggestion[] {
  const seen = new Set<string>();
  const chatFirst = commandRegistry.toSorted((a, b) => {
    return Number(b.menu?.menu === 'chat') - Number(a.menu?.menu === 'chat');
  });
  return chatFirst.flatMap(({ slash, help, title }) => {
    if (slash === undefined) {
      return [];
    }
    return suggestionsFrom({ usage: slash, description: help ?? title }).filter((suggestion) => {
      if (seen.has(suggestion.text)) {
        return false;
      }
      seen.add(suggestion.text);
      return true;
    });
  });
}

/** A usage and its `/help` line. */
interface ChatCommandUsage {
  readonly usage: string;
  readonly description: string;
}

/** The completions one usage stands for: a choice expands, and a placeholder ends the text. */
function suggestionsFrom({ usage, description }: ChatCommandUsage): ChatCommandSuggestion[] {
  const words = usage.split(' ');
  const placeholder = words.findIndex((word) => word.startsWith('<'));
  if (placeholder !== -1) {
    const text = `${words.slice(0, placeholder).join(' ')} `;
    return [{ text, label: usage, description, isComplete: false }];
  }
  let texts = [''];
  for (const word of words) {
    const choices = choicesOf(word);
    texts = texts.flatMap((head) => {
      return choices.map((choice) => {
        if (head === '') {
          return choice;
        }
        return `${head} ${choice}`;
      });
    });
  }
  return texts.map((text) => {
    return { text, label: text, description, isComplete: true };
  });
}

/** `split|inline` is two words; `--effort=low|high` keeps its `--effort=` on each. */
function choicesOf(word: string): readonly string[] {
  const equals = word.indexOf('=') + 1;
  const prefix = word.slice(0, equals);
  return word
    .slice(equals)
    .split('|')
    .map((choice) => `${prefix}${choice}`);
}
