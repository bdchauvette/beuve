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
  settings: TextmateSettings;
}

/** A rule's color and font style; an absent `fontStyle` inherits the enclosing scope's. */
export interface TextmateSettings {
  foreground: string;
  fontStyle?: string;
}

/**
 * beuve's TextMate theme (ADR 0025, 0119). Weight and slant carry the meaning, so color stays free
 * for the diff's own tints: names are bold, types are italic, keywords and punctuation are muted,
 * and operators, strings and constants are regular. Comments are the one colored class. Bold is
 * the default for a whole `source` scope rather than a list of identifier scopes, because grammars
 * leave many names unscoped (Python's locals and arguments, Rust's fields), so every other class
 * sets its font style explicitly. Markdown prose and plain text are `text` scopes and stay regular.
 * The scope matcher prefers the longer selector, which keeps whatever a comment or string holds (a
 * JSDoc tag, a regex quantifier, a quote) in the comment's or string's style, and code inside a
 * template literal's `${…}` in code's.
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
        name: 'Names',
        settings: { foreground: palette.foreground, fontStyle: bold },
        scope: nameScopes,
      }),
      rule({
        name: 'Types',
        settings: { foreground: palette.foreground, fontStyle: italic },
        scope: typeScopes,
      }),
      rule({
        name: 'Keywords and punctuation',
        settings: { foreground: palette.muted, fontStyle: regular },
        scope: mutedScopes,
      }),
      rule({
        name: 'Operators, strings and constants',
        settings: { foreground: palette.foreground, fontStyle: regular },
        scope: regularScopes,
      }),
      rule({
        name: 'Comments',
        settings: { foreground: palette.comment, fontStyle: regular },
        scope: commentScopes,
      }),
    ],
  };
}

const bold = 'bold';
const italic = 'italic';
const regular = '';

/** A rule's name, its settings, and the scopes it applies to. */
interface RuleParts {
  readonly name: string;
  readonly settings: TextmateSettings;
  readonly scope: readonly string[];
}

function rule({ name, settings, scope }: RuleParts): TextmateRule {
  return { name, scope: [...scope], settings: { ...settings } };
}

/**
 * A whole `source` scope, so that names a grammar leaves unscoped are bold, and the scopes names
 * do have, so that they stay bold inside an italic Python `def` line or a string's interpolation.
 */
const nameScopes: readonly string[] = [
  'source',
  'meta.template.expression',
  'entity.name',
  'entity.other',
  'variable',
  'support.function',
  'support.variable',
  'support.class',
];

/**
 * Python's grammar scopes no annotation types beyond the builtins, but everything else on a `def`
 * line has a scope of its own, so what is left unscoped there is a type.
 */
const typeScopes: readonly string[] = [
  'entity.name.type',
  'entity.other.inherited-class',
  'support.type.primitive',
  'support.type.builtin',
  'source.python support.type',
  'source.python meta.function',
  'source.go storage.type',
];

const mutedScopes: readonly string[] = [
  'keyword',
  'storage',
  'punctuation',
  'meta.brace',
  'keyword.operator.new',
  'keyword.operator.expression',
  'keyword.operator.type.annotation',
  'keyword.operator.key-value',
  'keyword.operator.access',
  'keyword.operator.arrow',
  'keyword.operator.namespace',
  'meta.template.expression keyword',
  'meta.template.expression storage',
  'meta.template.expression punctuation',
  'meta.template.expression meta.brace',
];

const regularScopes: readonly string[] = [
  'keyword.operator',
  'meta.template.expression keyword.operator',
  'constant',
  'string',
  'punctuation.definition.string',
  'string keyword',
  'string punctuation',
  'string meta.brace',
  'string storage',
  'markup.inline.raw',
];

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
