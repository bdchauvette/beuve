import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';
import ts from 'typescript';

type MessageIds = 'useTailOf';

/**
 * Keeps the end of a string with `tailOf(text, n)` (`#x/text/tail-of.ts`), not `text.slice(-n)`:
 * the slice can cut a surrogate pair and leave a lone low surrogate at the start, which becomes
 * U+FFFD in JSON and IPC or makes a strict UTF-8 encoder throw. Type-aware: array slices are fine.
 */
export const noStringTailSlice = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Use tailOf instead of slicing a negative offset off a string' },
    schema: [],
    messages: {
      useTailOf:
        'Use `tailOf(text, maxLength)` from `#x/text/tail-of.ts`: `slice(-n)` can cut a surrogate pair in half.',
    },
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      'CallExpression[arguments.length=1][callee.type="MemberExpression"][callee.property.name="slice"]'(
        node: TSESTree.CallExpression,
      ): void {
        const [argument] = node.arguments;
        if (
          node.callee.type !== AST_NODE_TYPES.MemberExpression ||
          argument?.type !== AST_NODE_TYPES.UnaryExpression ||
          argument.operator !== '-'
        ) {
          return;
        }
        const receiver = checker.getTypeAtLocation(
          services.esTreeNodeToTSNodeMap.get(node.callee.object),
        );
        if (isStringLike(receiver)) {
          context.report({ node, messageId: 'useTailOf' });
        }
      },
    };
  },
});

function isStringLike(type: ts.Type): boolean {
  return type.isUnion()
    ? type.types.every((member) => isStringLike(member))
    : (type.flags & ts.TypeFlags.StringLike) !== 0;
}
