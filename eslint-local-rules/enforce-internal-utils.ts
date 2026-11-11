import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type Options = [{ banned?: string[] }];
type MessageIds = 'useInternalUtils';

const defaultBanned = [
  'lodash',
  'lodash-es',
  'lodash.*',
  'underscore',
  'ramda',
  'rambda',
  'radash',
  'remeda',
  'es-toolkit',
];

/**
 * Steers contributors away from utility grab-bags toward built-ins and `#x/*` (spec 2.D).
 * Entries in `banned` are package names; a trailing `*` matches any suffix (`lodash.*`).
 */
export const enforceInternalUtils = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid utility grab-bag packages in favor of built-ins and #x/*' },
    schema: [
      {
        type: 'object',
        properties: { banned: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ banned: defaultBanned }],
    messages: {
      useInternalUtils:
        '"{{name}}" is a utility grab-bag; use a built-in or a small helper in #x/* instead.',
    },
  },
  create(context, [{ banned = defaultBanned }]) {
    const matchers = banned.map((pattern) => matcherFrom(pattern));
    const check = (source: TSESTree.Node | null | undefined): void => {
      if (source?.type !== AST_NODE_TYPES.Literal || typeof source.value !== 'string') {
        return;
      }
      const name = packageName(source.value);
      if (matchers.some((matches) => matches(name))) {
        context.report({ node: source, messageId: 'useInternalUtils', data: { name } });
      }
    };

    return {
      ImportDeclaration(node): void {
        check(node.source);
      },
      ExportAllDeclaration(node): void {
        check(node.source);
      },
      ExportNamedDeclaration(node): void {
        check(node.source);
      },
      ImportExpression(node): void {
        check(node.source);
      },
      TSImportEqualsDeclaration(node): void {
        if (node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference) {
          check(node.moduleReference.expression);
        }
      },
      CallExpression(node): void {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'require') {
          check(node.arguments[0]);
        }
      },
    };
  },
});

function packageName(specifier: string): string {
  const [first = '', second] = specifier.split('/', 2);
  if (second !== undefined && first.startsWith('@')) {
    return `${first}/${second}`;
  }
  return first;
}

/** `lodash*` matches every name that starts with `lodash`; anything else matches itself. */
function matcherFrom(pattern: string): (name: string) => boolean {
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return (name: string): boolean => name.startsWith(prefix);
  }
  return (name: string): boolean => name === pattern;
}
