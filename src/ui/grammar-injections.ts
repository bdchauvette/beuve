import type { LanguageRegistration } from 'shiki';

/**
 * TextMate injection grammars that add the scopes beuve's theme needs where a language's own
 * grammar leaves them out (ADR 0119): `variable.other.declaration` on the name a declaration
 * introduces, and, for Perl, awk and fish, the numbers and punctuation those grammars leave
 * unscoped. Keyed by the Shiki language each one is loaded with; `loadDiffsLibrary` appends it to
 * that language's grammars. Each applies outside strings and comments only, and its `L:` selector
 * makes it win a tie with the host grammar, so a pattern that takes over a keyword scopes the
 * keyword itself. The same priority would let an injection take the token that ends one of its own
 * begin/end rules, so those rules are `meta.declaration` and the selectors exclude it.
 */
export const grammarInjections: Readonly<Record<InjectedLanguage, LanguageRegistration>> =
  Object.freeze({
    python: injection('python', {
      selector:
        'L:source.python -string -comment -meta.function-call.arguments -meta.function.parameters -meta.item-access -meta.lambda-function',
      patterns: [
        {
          match: String.raw`^\s*((?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*)(?=\s*(?::\s*[^=\n]+)?=(?!=))`,
          captures: { 1: { patterns: pythonTargets() } },
        },
        {
          match: String.raw`\b(for)\s+((?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*)\s+(in)\b`,
          captures: {
            1: { name: 'keyword.control.flow.python' },
            2: { patterns: pythonTargets() },
            3: { name: 'keyword.control.flow.python' },
          },
        },
        {
          match: String.raw`\b(as)\s+([A-Za-z_]\w*)`,
          captures: {
            1: { name: 'keyword.control.flow.python' },
            2: { name: 'variable.other.declaration.python' },
          },
        },
      ],
    }),
    rust: injection('rust', {
      selector: 'L:source.rust -string -comment -meta.declaration',
      patterns: [
        {
          match: String.raw`\b(let)\s+(?:(mut)\s+)?([a-z_][A-Za-z0-9_]*)\b`,
          captures: {
            1: { name: 'storage.type.rust' },
            2: { name: 'storage.modifier.mut.rust' },
            3: { name: 'variable.other.declaration.rust' },
          },
        },
        {
          match: String.raw`\b(const|static)\s+(?:(mut)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?=:)`,
          captures: {
            1: { name: 'storage.type.rust' },
            2: { name: 'storage.modifier.mut.rust' },
            3: { name: 'variable.other.declaration.rust' },
          },
        },
        {
          match: String.raw`\b(for)\s+([a-z_][A-Za-z0-9_]*)\s+(in)\b`,
          captures: {
            1: { name: 'keyword.control.rust' },
            2: { name: 'variable.other.declaration.rust' },
            3: { name: 'keyword.other.rust' },
          },
        },
        {
          name: 'meta.declaration.rust',
          begin: String.raw`\b(fn)\s+([A-Za-z_][A-Za-z0-9_]*)`,
          beginCaptures: {
            1: { name: 'keyword.other.fn.rust' },
            2: { name: 'entity.name.function.rust' },
          },
          end: String.raw`(?<=\))|(?=[{;])`,
          patterns: [
            {
              match: String.raw`\b(?:(mut)\s+)?([a-z_][A-Za-z0-9_]*)\s*(?=:(?!:))`,
              captures: {
                1: { name: 'storage.modifier.mut.rust' },
                2: { name: 'variable.parameter.rust' },
              },
            },
            { include: 'source.rust' },
          ],
        },
      ],
    }),
    ruby: injection('ruby', {
      selector: 'L:source.ruby -string -comment',
      patterns: [
        {
          match: String.raw`(@@|@|\$)([A-Za-z_]\w*)(?=\s*(?:\|\|)?=(?![=~>]))`,
          captures: {
            1: { name: 'punctuation.definition.variable.ruby' },
            2: { name: 'variable.other.declaration.ruby' },
          },
        },
        {
          match: String.raw`^\s*([A-Z][A-Za-z0-9_]*)(?=\s*=(?![=~>]))`,
          captures: { 1: { name: 'variable.other.declaration.ruby' } },
        },
      ],
    }),
    perl: injection('perl', {
      selector: 'L:source.perl -string -comment -meta.declaration',
      patterns: [
        {
          match: String.raw`\b(my|our|local|state)\s+([$@%])([A-Za-z_]\w*)`,
          captures: {
            1: { name: 'storage.modifier.perl' },
            2: { name: 'punctuation.definition.variable.perl' },
            3: { name: 'variable.other.declaration.perl' },
          },
        },
        {
          name: 'meta.declaration.perl',
          begin: String.raw`\b(my|our|local|state)\s*(\()`,
          beginCaptures: {
            1: { name: 'storage.modifier.perl' },
            2: { name: 'punctuation.section.perl' },
          },
          end: String.raw`\)`,
          endCaptures: { 0: { name: 'punctuation.section.perl' } },
          patterns: [
            {
              match: String.raw`([$@%])([A-Za-z_]\w*)`,
              captures: {
                1: { name: 'punctuation.definition.variable.perl' },
                2: { name: 'variable.other.declaration.perl' },
              },
            },
            { match: ',', name: 'punctuation.separator.perl' },
          ],
        },
        perlNumber(),
        ...perlPunctuation(),
      ],
    }),
    awk: injection('awk', {
      selector: 'L:source.awk -string -comment',
      patterns: [
        {
          match: String.raw`\b(for)\s*(\()\s*([A-Za-z_]\w*)\s+(in)\b`,
          captures: {
            1: { name: 'keyword.control.awk' },
            2: { name: 'punctuation.section.awk' },
            3: { name: 'variable.other.declaration.awk' },
            4: { name: 'keyword.control.awk' },
          },
        },
        {
          match: String.raw`(?<![\w$])([A-Za-z_]\w*)(?=\s*(?:\[[^\]]*\])?\s*=(?!=))`,
          captures: { 1: { name: 'variable.other.declaration.awk' } },
        },
        // Not parentheses: awk's parameter list is a rule that a taken `)` would never close.
        { match: ';', name: 'punctuation.terminator.awk' },
        { match: ',', name: 'punctuation.separator.awk' },
        { match: String.raw`[{}\[\]]`, name: 'punctuation.section.awk' },
      ],
    }),
    // fish's command rule starts at a line's indentation, so these do too, to tie with it and win.
    fish: injection('fish', {
      selector: 'L:source.fish -string -comment -meta.declaration',
      patterns: [
        {
          match: String.raw`\s*\b(set)((?:\s+--?[A-Za-z][A-Za-z-]*)*)\s+([A-Za-z_][A-Za-z0-9_]*)`,
          captures: {
            1: { name: 'support.function.command.fish' },
            2: { name: 'constant.other.option.fish' },
            3: { name: 'variable.other.declaration.fish' },
          },
        },
        {
          name: 'meta.declaration.fish',
          begin: String.raw`\s*\b(function)\s+([^\s;]+)`,
          beginCaptures: {
            1: { name: 'keyword.control.fish' },
            2: { name: 'entity.name.function.fish' },
          },
          end: '$|(?=;)',
          patterns: [
            {
              match: String.raw`(--argument-names|--argument|-a)((?:\s+[A-Za-z_][A-Za-z0-9_]*)+)`,
              captures: {
                1: { name: 'constant.other.option.fish' },
                2: {
                  patterns: [{ match: String.raw`[A-Za-z_]\w*`, name: 'variable.parameter.fish' }],
                },
              },
            },
            { match: '--?[A-Za-z][A-Za-z-]*', name: 'constant.other.option.fish' },
          ],
        },
        {
          match: String.raw`\s*\b(for)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(in)\b`,
          captures: {
            1: { name: 'keyword.control.fish' },
            2: { name: 'variable.other.declaration.fish' },
            3: { name: 'keyword.control.fish' },
          },
        },
        {
          match: String.raw`(?<![\w$./-])\d+(?:\.\d+)?(?![\w./-])`,
          name: 'constant.numeric.fish',
        },
        { match: ';', name: 'punctuation.terminator.fish' },
      ],
    }),
  });

/** A language {@link grammarInjections} adds scopes to. */
export type InjectedLanguage = 'python' | 'rust' | 'ruby' | 'perl' | 'awk' | 'fish';

type GrammarPatterns = LanguageRegistration['patterns'];
type GrammarPattern = GrammarPatterns[number];

/** Where an injection applies and what it matches. */
interface InjectionParts {
  readonly selector: string;
  readonly patterns: GrammarPatterns;
}

function injection(language: InjectedLanguage, parts: InjectionParts): LanguageRegistration {
  return {
    name: `beuve-${language}-injection`,
    scopeName: `beuve.injection.${language}`,
    injectTo: [`source.${language}`],
    injectionSelector: parts.selector,
    patterns: parts.patterns,
    repository: {},
  };
}

function pythonTargets(): GrammarPatterns {
  return [
    { match: String.raw`[A-Za-z_]\w*`, name: 'variable.other.declaration.python' },
    { match: ',', name: 'punctuation.separator.python' },
  ];
}

function perlNumber(): GrammarPattern {
  return {
    match: String.raw`(?<![\w$@%.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)\b`,
    name: 'constant.numeric.perl',
  };
}

function perlPunctuation(): GrammarPatterns {
  return [
    { match: ';', name: 'punctuation.terminator.perl' },
    { match: ',', name: 'punctuation.separator.perl' },
    { match: String.raw`[(){}\[\]]`, name: 'punctuation.section.perl' },
  ];
}
