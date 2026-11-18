import emojiByName from 'markdown-it-emoji/lib/data/full.mjs';

/** One emoji a `:name` can complete to (ADR 0143). */
export interface EmojiSuggestion {
  /** The shortcode without colons: `tada`. */
  readonly name: string;
  /** What choosing it inserts: `🎉`. */
  readonly emoji: string;
}

/** The longest list shown; the reviewer types on to narrow it. */
const maxSuggestions = 8;

/**
 * The emoji whose shortcode contains `name` (lowercase, without colons), for a text field's
 * completion list (ADR 0143), from the `full` table the rendered Markdown view uses (ADR 0123),
 * so a note's `:tada:` and its completion agree. The exact name comes first, then names that
 * start with it, then names with a word (after `_`) that does, then the rest; shorter names first
 * within each, then the table's order. An emoji with several names is listed once, under the
 * first. At most eight. Pure; a scan of the 1,903 names per keystroke.
 */
export function matchEmojiShortcodes(name: string): readonly EmojiSuggestion[] {
  if (name === '') {
    return [];
  }
  const ranked: RankedSuggestion[] = [];
  for (const [index, suggestion] of suggestions.entries()) {
    const rank = rankOf(suggestion.name, name);
    if (rank === undefined) {
      continue;
    }
    ranked.push({ suggestion, rank, index });
  }
  ranked.sort((a, b) => {
    return (
      a.rank - b.rank || a.suggestion.name.length - b.suggestion.name.length || a.index - b.index
    );
  });
  const seen = new Set<string>();
  const matches: EmojiSuggestion[] = [];
  for (const { suggestion } of ranked) {
    if (matches.length === maxSuggestions) {
      break;
    }
    if (seen.has(suggestion.emoji)) {
      continue;
    }
    seen.add(suggestion.emoji);
    matches.push(suggestion);
  }
  return matches;
}

interface RankedSuggestion {
  readonly suggestion: EmojiSuggestion;
  readonly rank: number;
  readonly index: number;
}

const suggestions: readonly EmojiSuggestion[] = Object.freeze(
  Object.entries(emojiByName).map(([name, emoji]) => {
    return { name, emoji };
  }),
);

/**
 * How well the name `actual` matches the typed `expected`: 0 exact, 1 prefix, 2 a later word's
 * prefix, 3 anywhere; `undefined` for no match.
 */
function rankOf(actual: string, expected: string): number | undefined {
  if (actual === expected) {
    return 0;
  }
  if (actual.startsWith(expected)) {
    return 1;
  }
  if (actual.includes(`_${expected}`)) {
    return 2;
  }
  if (actual.includes(expected)) {
    return 3;
  }
  return undefined;
}
