import { ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'british';

const isePrefixes = [
  'anal',
  'apolog',
  'authori',
  'capital',
  'categor',
  'character',
  'critic',
  'custom',
  'ellips',
  'emphas',
  'final',
  'formal',
  'general',
  'global',
  'initial',
  'italic',
  'local',
  'material',
  'maxim',
  'memor',
  'minim',
  'normal',
  'optim',
  'organ',
  'parameter',
  'priorit',
  'random',
  'real',
  'recogn',
  'sanit',
  'serial',
  'special',
  'stabil',
  'standard',
  'summar',
  'symbol',
  'synchron',
  'token',
  'util',
  'virtual',
  'visual',
];

const alternatives = [
  '(?:col|behavi|neighb|fav|hon)our\\w*',
  'centre[sd]?',
  '(?:def|off|lic)ence[sd]?',
  'grey(?:s|ed|ing|ish)?',
  'whilst|amongst',
  '(?:anal|paral|catal)ys(?:e|es|ed|ing)',
  '(?:label|model|travel|signal|fuel|level)l(?:ed|ing|er|ers)',
  `(?:${isePrefixes.join('|')})is(?:e|es|ed|ing|ation|ations|er|ers)`,
];

// eslint-disable-next-line security/detect-non-literal-regexp -- built from the constant lists above
const britishWord = new RegExp(String.raw`\b(?:${alternatives.join('|')})\b`, 'gi');

const centreEndings: Readonly<Record<string, string>> = { '': '', s: 's', d: 'ed' };

/**
 * The product is written in American English. Reports a British spelling (`colour`, `neighbours`,
 * `normalise`, `labelled`, …) in a string, a template's text or a comment, with its American
 * form. It reads text and not identifiers, so it keeps what a user, a log or a reader sees
 * consistent without renaming code that merely mentions a word. `cancelled` is not reported:
 * American English accepts it, and it is a status value on the wire.
 */
export const americanSpelling = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Require American spellings in strings and comments' },
    schema: [],
    messages: {
      british: "Use the American spelling: '{{american}}', not '{{british}}'.",
    },
  },
  create(context) {
    const checkText = (text: string, at: Pick<TSESTree.Node, 'loc'>): void => {
      for (const match of text.matchAll(britishWord)) {
        const british = match[0];
        context.report({
          loc: at.loc,
          messageId: 'british',
          data: { british, american: americanFrom(british) },
        });
      }
    };
    return {
      Literal(node): void {
        if (typeof node.value === 'string') {
          checkText(node.value, node);
        }
      },
      TemplateElement(node): void {
        checkText(node.value.cooked ?? node.value.raw, node);
      },
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          checkText(comment.value, comment);
        }
      },
    };
  },
});

const spellings: readonly (readonly [RegExp, string])[] = [
  [/^(col|behavi|neighb|fav|hon)our/, '$1or'],
  [/^(def|off|lic)ence/, '$1ense'],
  [/^grey/, 'gray'],
  [/^whilst$/, 'while'],
  [/^amongst$/, 'among'],
  [/ys(e|es|ed|ing)$/, 'yz$1'],
  [/([aeiou])ll(ed|ing|er|ers)$/, '$1l$2'],
  [/is(e|es|ed|ing|ation|ations|er|ers)$/, 'iz$1'],
];

const centreWord = /^centre([sd]?)$/;

function americanFrom(word: string): string {
  const lower = word.toLowerCase();
  const centre = centreWord.exec(lower);
  if (centre !== null) {
    return `center${centreEndings[centre[1] ?? ''] ?? ''}`;
  }
  let american = lower;
  for (const [pattern, replacement] of spellings) {
    // eslint-disable-next-line unicorn/no-unsafe-string-replacement -- the table holds literal replacements
    american = american.replace(pattern, replacement);
  }
  return american;
}
