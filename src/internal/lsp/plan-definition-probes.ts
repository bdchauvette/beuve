/** A token on one line: UTF-16 columns, `end` exclusive. */
export interface ProbeToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const identifierPattern = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const keywords: ReadonlySet<string> = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'def',
  'default',
  'delete',
  'do',
  'elif',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'fn',
  'for',
  'from',
  'func',
  'function',
  'get',
  'go',
  'if',
  'impl',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'match',
  'mut',
  'namespace',
  'new',
  'null',
  'of',
  'override',
  'package',
  'private',
  'protected',
  'pub',
  'public',
  'readonly',
  'return',
  'satisfies',
  'self',
  'set',
  'static',
  'struct',
  'super',
  'switch',
  'this',
  'throw',
  'trait',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'use',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);
const declarations: ReadonlySet<string> = new Set([
  'class',
  'const',
  'def',
  'enum',
  'fn',
  'func',
  'function',
  'interface',
  'let',
  'namespace',
  'struct',
  'trait',
  'type',
  'var',
]);
const maxProbes = 6;
const callFollows = /^\s*[(<]/u;
const quotes: ReadonlySet<string> = new Set(['"', "'", '`']);

/** How {@link planDefinitionProbes} is used. */
export interface ProbePlanOptions {
  /**
   * The pointer's identifier alone and only if the pointer is on it (not just after it) and it
   * isn't a keyword: nothing else on the line is probed (ADR 0105). Needs `character`.
   */
  readonly link?: boolean;
}

/**
 * Which tokens of a line to ask the language server about, best first (ADR 0067). With a known
 * `character`, the identifier under it (or just before it) alone. Otherwise the line's
 * identifiers outside strings and comments, keywords left out: calls first (a name followed by
 * `(` or `<`), then the rest left to right, and names the line itself declares last, since their
 * definition is the line itself. At most six. Pure.
 */
export function planDefinitionProbes(
  text: string,
  character?: number,
  options: ProbePlanOptions = {},
): readonly ProbeToken[] {
  const tokens = identifiersOf(text);
  if (options.link === true) {
    return tokens.filter((token) => {
      return (
        character !== undefined &&
        token.start <= character &&
        character < token.end &&
        !keywords.has(token.text)
      );
    });
  }
  if (character !== undefined) {
    const under = tokens.find((token) => token.start <= character && character <= token.end);
    if (under !== undefined) {
      return [under];
    }
  }
  const candidates = tokens.filter((token) => !keywords.has(token.text));
  const declared = new Set(
    tokens
      .filter((token, index) => declarations.has(token.text) && index + 1 < tokens.length)
      .map((token) => tokens[tokens.indexOf(token) + 1]?.start),
  );
  const isCall = (token: ProbeToken): boolean => callFollows.test(text.slice(token.end));
  const rank = (token: ProbeToken): number => {
    if (declared.has(token.start)) {
      return 2;
    }
    if (isCall(token)) {
      return 0;
    }
    return 1;
  };
  return candidates
    .map((token, index) => {
      return { token, index };
    })
    .toSorted((left, right) => rank(left.token) - rank(right.token) || left.index - right.index)
    .slice(0, maxProbes)
    .map(({ token }) => token);
}

/** Identifiers outside string literals and `//` or `/*` comments. */
function identifiersOf(text: string): ProbeToken[] {
  const code = blankLiteralsAndComments(text);
  return Array.from(code.matchAll(identifierPattern), (match) => {
    return {
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    };
  });
}

function blankLiteralsAndComments(text: string): string {
  let result = '';
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (quote !== undefined) {
      if (char === '\\') {
        result += '  ';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      result += ' ';
      continue;
    }
    if (char === '/' && (text[index + 1] === '/' || text[index + 1] === '*')) {
      return result + ' '.repeat(text.length - index);
    }
    if (quotes.has(char)) {
      quote = char;
      result += ' ';
      continue;
    }
    result += char;
  }
  return result;
}
