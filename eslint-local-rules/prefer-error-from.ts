import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'conditional' | 'caught';

/**
 * Normalises an unknown error with `errorFrom(value)` (`#x/error/error-from.ts`), not by hand:
 *
 * - a conditional that tests `Error.isError(x)` or `x instanceof Error` and has `String(x)` in
 *   either branch (`Error.isError(e) ? e.message : String(e)`);
 * - `String(x)` where `x` is the parameter of the enclosing `catch` clause.
 *
 * `String(error)` prints `SyntaxError: …` for an error and `[object Object]` for an object, and
 * the hand-written conditional copies that fallback everywhere.
 */
export const preferErrorFrom = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Use errorFrom to normalise an unknown error' },
    schema: [],
    messages: {
      conditional:
        'This is a hand-written `errorFrom`. Use `errorFrom({{value}})` from `#x/error/error-from.ts` (`errorFrom({{value}}).message` for the text).',
      caught:
        '`String({{value}})` on a caught value. Use `errorFrom({{value}}).message` from `#x/error/error-from.ts`.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const covered = new Set<TSESTree.Node>();
    return {
      ConditionalExpression(node): void {
        for (const tested of testedValues(node.test)) {
          const text = sourceCode.getText(tested);
          const fallback = [node.consequent, node.alternate]
            .map((branch) => stringCallOf(branch, text, sourceCode))
            .find((call) => call !== undefined);
          if (fallback !== undefined) {
            covered.add(fallback);
            context.report({ node, messageId: 'conditional', data: { value: text } });
            return;
          }
        }
      },
      'CallExpression[callee.type="Identifier"][callee.name="String"]'(
        node: TSESTree.CallExpression,
      ): void {
        const [argument] = node.arguments;
        if (
          !covered.has(node) &&
          argument?.type === AST_NODE_TYPES.Identifier &&
          isCatchParameter(argument, sourceCode.getScope(node))
        ) {
          context.report({ node, messageId: 'caught', data: { value: argument.name } });
        }
      },
    };
  },
});

function testedValues(start: TSESTree.Node): readonly TSESTree.Node[] {
  let test = start;
  while (test.type === AST_NODE_TYPES.UnaryExpression && test.operator === '!') {
    test = test.argument;
  }
  switch (test.type) {
    case AST_NODE_TYPES.LogicalExpression: {
      return [...testedValues(test.left), ...testedValues(test.right)];
    }
    case AST_NODE_TYPES.BinaryExpression: {
      if (test.operator === 'instanceof' && isErrorIdentifier(test.right)) {
        return [test.left];
      }
      return [];
    }
    case AST_NODE_TYPES.CallExpression: {
      const [argument] = test.arguments;
      if (argument !== undefined && isErrorIsError(test.callee)) {
        return [argument];
      }
      return [];
    }
    default: {
      return [];
    }
  }
}

function isErrorIdentifier(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Identifier && node.name === 'Error';
}

function isErrorIsError(callee: TSESTree.Node): boolean {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    isErrorIdentifier(callee.object) &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'isError'
  );
}

function stringCallOf(
  node: TSESTree.Node,
  text: string,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Node | undefined {
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'String' &&
    node.arguments.length === 1 &&
    node.arguments[0] !== undefined &&
    sourceCode.getText(node.arguments[0]) === text
  ) {
    return node;
  }
  const keys = sourceCode.visitorKeys[node.type] ?? [];
  return keys
    .flatMap((key) => {
      const child: unknown = (node as unknown as Record<string, unknown>)[key];
      return [child].flat();
    })
    .filter((item): item is TSESTree.Node => isNode(item))
    .map((item) => stringCallOf(item, text, sourceCode))
    .find((found) => found !== undefined);
}

function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function isCatchParameter(identifier: TSESTree.Identifier, scope: TSESLint.Scope.Scope): boolean {
  let current: TSESLint.Scope.Scope | null = scope;
  while (current !== null) {
    const variable = current.set.get(identifier.name);
    if (variable !== undefined) {
      return variable.defs.some((definition) => {
        return definition.type === TSESLint.Scope.DefinitionType.CatchClause;
      });
    }
    current = current.upper;
  }
  return false;
}
