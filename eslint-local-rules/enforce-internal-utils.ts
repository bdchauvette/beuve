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
 * Steers contributors away from utility grab-bags towards built-ins and `#pkg/*` (spec 2.D).
 * Entries in `banned` are package names; a trailing `*` matches any suffix (`lodash.*`).
 */
export const enforceInternalUtils = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid utility grab-bag packages in favour of built-ins and #pkg/*' },
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
        '"{{name}}" is a utility grab-bag; use a built-in or a small helper in #pkg/* instead.',
    },
  },
  create(context, [{ banned = defaultBanned }]) {
    const check = (source: TSESTree.Node | null | undefined): void => {
      if (source?.type !== AST_NODE_TYPES.Literal || typeof source.value !== 'string') {
        return;
      }
      const name = packageName(source.value);
      if (banned.some((pattern) => isMatch(pattern, name))) {
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
  const segments = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  return segments.slice(0, count).join('/');
}

function isMatch(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}
