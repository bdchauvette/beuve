import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'useFunctionDeclaration' | 'useArrowForNested' | 'useArrowForExpression';

/**
 * Top-level functions use `function` declarations; every inner helper and function
 * expression is an arrow. Class and object methods, and generators, are exempt.
 */
export const enforceTopLevelFunctionSyntax = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require `function` declarations at top level and arrow functions elsewhere',
    },
    schema: [],
    messages: {
      useFunctionDeclaration:
        'Declare top-level function "{{name}}" with `function {{name}}() {}` instead of a variable.',
      useArrowForNested:
        'Nested function "{{name}}" should be an arrow function: `const {{name}} = () => {}`.',
      useArrowForExpression: 'Use an arrow function instead of a function expression.',
    },
  },
  create(context) {
    return {
      'Program > VariableDeclaration > VariableDeclarator, Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'(
        node: TSESTree.VariableDeclarator,
      ): void {
        if (node.init !== null && isFunctionValue(unwrapTypeAssertions(node.init))) {
          context.report({
            node,
            messageId: 'useFunctionDeclaration',
            data: { name: node.id.type === AST_NODE_TYPES.Identifier ? node.id.name : 'fn' },
          });
        }
      },
      FunctionDeclaration(node): void {
        if (!node.generator && isInsideFunction(context.sourceCode.getAncestors(node))) {
          context.report({
            node: node.id ?? node,
            messageId: 'useArrowForNested',
            data: { name: node.id?.name ?? 'fn' },
          });
        }
      },
      FunctionExpression(node): void {
        if (node.generator || isMethodLike(node) || isTopLevelInitializer(node)) {
          return;
        }
        context.report({ node, messageId: 'useArrowForExpression' });
      },
    };
  },
});

function unwrapTypeAssertions(node: TSESTree.Expression): TSESTree.Expression {
  let current = node;
  while (isTypeAssertion(current)) {
    current = current.expression;
  }
  return current;
}

function isTypeAssertion(
  node: TSESTree.Node,
): node is
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion {
  return (
    node.type === AST_NODE_TYPES.TSAsExpression ||
    node.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node.type === AST_NODE_TYPES.TSNonNullExpression ||
    node.type === AST_NODE_TYPES.TSTypeAssertion
  );
}

function isFunctionValue(node: TSESTree.Expression): boolean {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression
  );
}

function isInsideFunction(ancestors: TSESTree.Node[]): boolean {
  return ancestors.some(
    (ancestor) =>
      ancestor.type === AST_NODE_TYPES.FunctionDeclaration ||
      ancestor.type === AST_NODE_TYPES.FunctionExpression ||
      ancestor.type === AST_NODE_TYPES.ArrowFunctionExpression,
  );
}

function isMethodLike(node: TSESTree.FunctionExpression): boolean {
  const { parent } = node;
  return (
    parent.type === AST_NODE_TYPES.MethodDefinition ||
    (parent.type === AST_NODE_TYPES.Property &&
      parent.value === node &&
      (parent.method || parent.kind !== 'init'))
  );
}

function isTopLevelInitializer(node: TSESTree.FunctionExpression): boolean {
  let current: TSESTree.Node = node.parent;
  while (isTypeAssertion(current)) {
    current = current.parent;
  }
  if (current.type !== AST_NODE_TYPES.VariableDeclarator) {
    return false;
  }
  const declaration = current.parent;
  const holder = declaration.parent;
  return (
    holder.type === AST_NODE_TYPES.Program ||
    (holder.type === AST_NODE_TYPES.ExportNamedDeclaration &&
      holder.parent.type === AST_NODE_TYPES.Program)
  );
}
