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
 * An Alabaster-style TextMate theme (ADR 0025): strings, constants, comments and definitions get
 * color, everything else is plain foreground. No keyword, operator or punctuation colors, no bold
 * or italics. Grammars tag names at use sites with the same `entity.name` scopes as definitions,
 * so the "plain" rule takes back calls, type references, tags and commands; the scope matcher
 * prefers the longer selector, so it overrides the broad definition rule.
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
      rule('Comments', palette.comment, ['comment', 'punctuation.definition.comment']),
      rule('Strings', palette.string, [
        'string',
        'constant.character.escape',
        'constant.other.placeholder',
        'constant.character.format.placeholder',
        'markup.inline.raw',
      ]),
      rule('Constants', palette.constant, ['constant']),
      rule('Definitions', palette.definition, [
        'entity.name',
        'entity.name.type.class',
        'entity.name.type.interface',
        'entity.name.type.alias',
        'entity.name.type.enum',
        'entity.name.type.struct',
        'entity.name.type.trait',
      ]),
      rule('Plain: uses of names and template code', palette.foreground, plainScopes),
    ],
  };
}

function rule(name: string, color: string, scope: readonly string[]): TextmateRule {
  return { name, scope: [...scope], settings: { foreground: color } };
}

const plainScopes: readonly string[] = [
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
