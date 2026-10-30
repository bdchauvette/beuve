import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'preferUrlParse';

const functionTypes = new Set<string>([
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
]);

/**
 * Parses URLs with `URL.parse(…)`, which returns `null`, not with `new URL(…)` inside a `try`
 * whose `catch` only returns or assigns a fallback. The `try` doubles as control flow and also
 * swallows any other error raised inside it.
 */
export const preferUrlParse = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Use URL.parse instead of try/catch around new URL' },
    schema: [],
    messages: {
      preferUrlParse:
        'Use `URL.parse(…)`, which returns `null` for an invalid URL, instead of `new URL(…)` in a `try` that only falls back.',
    },
  },
  create(context) {
    return {
      'NewExpression[callee.type="Identifier"][callee.name="URL"]'(
        node: TSESTree.NewExpression,
      ): void {
        if (isGuardedByFallbackTry(node, context.sourceCode.getAncestors(node))) {
          context.report({ node, messageId: 'preferUrlParse' });
        }
      },
    };
  },
});

function isGuardedByFallbackTry(
  node: TSESTree.NewExpression,
  ancestors: readonly TSESTree.Node[],
): boolean {
  let child: TSESTree.Node = node;
  for (const ancestor of ancestors.toReversed()) {
    if (functionTypes.has(ancestor.type)) {
      return false;
    }
    if (
      ancestor.type === AST_NODE_TYPES.TryStatement &&
      ancestor.block === child &&
      ancestor.finalizer === null &&
      ancestor.handler?.body.body.every((statement) => isFallback(statement)) === true
    ) {
      return true;
    }
    child = ancestor;
  }
  return false;
}

function isFallback(statement: TSESTree.Statement): boolean {
  return (
    statement.type === AST_NODE_TYPES.ReturnStatement ||
    statement.type === AST_NODE_TYPES.EmptyStatement ||
    (statement.type === AST_NODE_TYPES.ExpressionStatement &&
      statement.expression.type === AST_NODE_TYPES.AssignmentExpression)
  );
}
