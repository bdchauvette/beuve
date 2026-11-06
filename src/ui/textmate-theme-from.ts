import type { SyntaxPalette } from './syntax-palettes.ts';

/**
 * The subset of a TextMate theme (Shiki's `ThemeRegistration`) beuve produces. Mutable arrays
 * because Shiki's types are; build a fresh one per use.
 */
export interface TextmateTheme {
  name: string;
  type: 'light' | 'dark';
  fg: string;
  bg: string;
  colors: Record<string, string>;
  tokenColors: TextmateRule[];
}

export interface TextmateRule {
  name: string;
  scope: string[];
  settings: { foreground: string };
}

/**
 * An Alabaster-style TextMate theme (ADR 0025, 0119): strings, constants, comments and definitions
 * get color, keywords, operators and punctuation are muted so names stand out, and everything else
 * is plain foreground. No bold or italics. Grammars tag names at use sites with the same
 * `entity.name` scopes as definitions, so the "plain" rule takes back calls, type references, tags
 * and commands; the scope matcher prefers the longer selector, so it overrides the broad definition
 * rule. The same preference keeps whatever a comment or string holds (a JSDoc tag, a regex
 * quantifier, a quote) in the comment's or string's color.
 */
export function textmateThemeFrom(
  name: string,
  type: 'light' | 'dark',
  palette: SyntaxPalette,
): TextmateTheme {
  return {
    name,
    type,
    fg: palette.foreground,
    bg: palette.background,
    colors: {
      'editor.foreground': palette.foreground,
      'editor.background': palette.background,
    },
    tokenColors: [
      rule({
        name: 'Comments',
        foreground: palette.comment,
        scope: commentScopes,
      }),
      rule({
        name: 'Strings',
        foreground: palette.string,
        scope: stringScopes,
      }),
      rule({ name: 'Constants', foreground: palette.constant, scope: ['constant'] }),
      rule({
        name: 'Definitions',
        foreground: palette.definition,
        scope: [
          'entity.name',
          'entity.name.type.class',
          'entity.name.type.interface',
          'entity.name.type.alias',
          'entity.name.type.enum',
          'entity.name.type.struct',
          'entity.name.type.trait',
        ],
      }),
      rule({
        name: 'Muted: keywords, operators and punctuation',
        foreground: palette.muted,
        scope: mutedScopes,
      }),
      rule({
        name: 'Plain: uses of names and template code',
        foreground: palette.foreground,
        scope: plainScopes,
      }),
    ],
  };
}

/** A rule's name, its color, and the scopes it colors. */
interface RuleParts {
  readonly name: string;
  readonly foreground: string;
  readonly scope: readonly string[];
}

function rule({ name, foreground, scope }: RuleParts): TextmateRule {
  return { name, scope: [...scope], settings: { foreground } };
}

const commentScopes: readonly string[] = [
  'comment',
  'punctuation.definition.comment',
  'comment keyword',
  'comment storage',
  'comment punctuation',
  'comment meta.brace',
  'comment entity',
  'comment entity.name',
  'comment entity.name.type',
  'comment variable',
  'comment constant',
];

const stringScopes: readonly string[] = [
  'string',
  'punctuation.definition.string',
  'string keyword',
  'string punctuation',
  'string meta.brace',
  'string storage',
  'constant.character.escape',
  'constant.other.placeholder',
  'constant.character.format.placeholder',
  'markup.inline.raw',
];

const mutedScopes: readonly string[] = [
  'keyword',
  'storage',
  'punctuation',
  'meta.brace',
  'meta.template.expression keyword',
  'meta.template.expression storage',
  'meta.template.expression punctuation',
  'meta.template.expression meta.brace',
];

const plainScopes: readonly string[] = [
  'source.go storage.type',
  'entity.name.type',
  'entity.name.tag',
  'entity.name.command',
  'entity.name.function.call',
  'entity.name.function.support',
  'entity.name.function.macro',
  'meta.function-call entity.name.function',
  'meta.function.call entity.name.function',
  'meta.template.expression',
];
