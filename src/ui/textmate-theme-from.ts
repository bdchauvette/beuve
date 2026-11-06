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
 * beuve's TextMate theme (ADR 0025, 0119). Weight, slant and contrast carry the meaning, so color
 * stays free for the diff's own tints: definitions and numbers are bold, types are italic,
 * keywords and punctuation are muted, and names, property keys, operators and strings are regular
 * text. Comments are the one colored class. A declaration (a variable, constant or parameter) is a
 * definition too, where the language's grammar marks it as one. Grammars tag names at use sites with the same
 * `entity.name` scopes as definitions, so a rule takes calls, tags and commands back to regular;
 * the scope matcher prefers the longer selector. The same preference keeps whatever a comment or
 * string holds (a JSDoc tag, a regex quantifier, a quote) in the comment's or string's style.
 * Every rule sets its font style, because an unset one inherits the enclosing scope's.
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
        name: 'Names, operators and strings',
        settings: { foreground: palette.foreground, fontStyle: regular },
        scope: regularScopes,
      }),
      rule({
        name: 'Definitions and declarations',
        settings: { foreground: palette.foreground, fontStyle: bold },
        scope: definitionScopes,
      }),
      rule({
        name: 'Types',
        settings: { foreground: palette.foreground, fontStyle: italic },
        scope: typeScopes,
      }),
      rule({
        name: 'Type definitions',
        settings: { foreground: palette.foreground, fontStyle: boldItalic },
        scope: typeDefinitionScopes,
      }),
      rule({
        name: 'Numbers',
        settings: { foreground: palette.foreground, fontStyle: bold },
        scope: ['constant.numeric'],
      }),
      rule({
        name: 'Keywords and punctuation',
        settings: { foreground: palette.muted, fontStyle: regular },
        scope: mutedScopes,
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
const boldItalic = 'bold italic';
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
 * Code, names, operators, strings and the constants that are not numbers, and the `entity.name`
 * scopes grammars give uses: calls, tags, commands and namespaces.
 */
const regularScopes: readonly string[] = [
  'source',
  'variable.parameter.positional',
  'variable.parameter.function-call',
  'variable',
  'support',
  'entity.other',
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
  'entity.name.tag',
  'entity.name.command',
  'entity.name.namespace',
  'entity.name.function.call',
  'entity.name.function.support',
  'entity.name.function.macro',
  'meta.function-call entity.name.function',
  'meta.function.call entity.name.function',
];

/**
 * What grammars give the names that definitions and declarations introduce, and the
 * `variable.parameter` uses taken back: shell's `$1` and Python's keyword arguments at a call.
 */
const definitionScopes: readonly string[] = [
  'entity.name',
  'meta.definition.variable variable',
  'variable.parameter',
  'variable.other.assignment',
  'variable.other.for',
  'variable.ruby',
  'source.ruby variable.other.block',
  'source.go variable.other.constant',
  'variable.css',
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

const typeDefinitionScopes: readonly string[] = [
  'entity.name.type.class',
  'entity.name.type.interface',
  'entity.name.type.alias',
  'entity.name.type.enum',
  'entity.name.type.struct',
  'entity.name.type.trait',
  'entity.name.type.module',
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
  'comment constant.numeric',
];
