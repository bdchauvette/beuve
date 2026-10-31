/** Where a query matched: higher scores are better; `indices` are the matched characters. */
export interface FuzzyMatch {
  readonly score: number;
  readonly indices: readonly number[];
}

const boundary = /[\s/._\-:#([]/u;

/** What to look for, and the text to look in. */
export interface FuzzyQuery {
  readonly query: string;
  readonly text: string;
}

/**
 * Case-insensitive subsequence match of `query` in `text`, preferring matches at word starts
 * (after a space, `/`, `.`, `-`, `_`, `:`, `#` or a lowercase-to-uppercase step), runs of
 * consecutive characters, an early first match and shorter texts. Each query character takes the
 * best-scoring position greedily from the left, which is good enough for palette-sized lists.
 * An empty query matches everything with score 0; `undefined` when some character is missing.
 * Pure.
 */
export function fuzzyMatch({ query, text }: FuzzyQuery): FuzzyMatch | undefined {
  const needle = query.toLowerCase().replaceAll(/\s+/gu, '');
  if (needle === '') {
    return { score: 0, indices: [] };
  }
  const haystack = text.toLowerCase();
  /** The next occurrence at a word start if there is one before the next plain occurrence's run ends. */
  const bestPosition = (
    character: string,
    from: number,
    previous: number | undefined,
  ): number | undefined => {
    const first = haystack.indexOf(character, from);
    if (first === -1) {
      return undefined;
    }
    if (previous !== undefined && first === previous + 1) {
      return first;
    }
    for (let at = first; at !== -1; at = haystack.indexOf(character, at + 1)) {
      if (isWordStart(text, at)) {
        return at;
      }
    }
    return first;
  };
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const character of needle) {
    const at = bestPosition(character, from, indices.at(-1));
    if (at === undefined) {
      return undefined;
    }
    score += positionScore(text, at, indices.at(-1));
    indices.push(at);
    from = at + 1;
  }
  score -= (indices[0] ?? 0) * 0.2 + text.length * 0.01;
  return { score, indices };
}

function positionScore(text: string, at: number, previous: number | undefined): number {
  let score = 1;
  if (previous !== undefined && at === previous + 1) {
    score += 5;
  }
  if (isWordStart(text, at)) {
    score += 8;
  }
  return score;
}

function isWordStart(text: string, at: number): boolean {
  if (at === 0) {
    return true;
  }
  const before = text[at - 1] ?? '';
  const current = text[at] ?? '';
  return (
    boundary.test(before) || (before === before.toLowerCase() && current !== current.toLowerCase())
  );
}
