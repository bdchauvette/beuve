import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'imported' | 'notFromContext';

/**
 * Requires `expect` to come from the test context, `test('…', ({ expect }) => …)` (ADR 0058), so
 * concurrent tests count their own assertions and snapshots. `expect` may not be imported from
 * vitest (or read off a namespace import of it), and every `expect` must resolve to a function
 * parameter: the test callback's, or a helper's that receives it.
 */
export const expectFromTestContext = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Require expect from the test context' },
    schema: [],
    messages: {
      imported:
        "Don't import `expect`; take it from the test context: `test('…', ({ expect }) => …)`.",
      notFromContext:
        "`expect` must come from the test context: `test('…', ({ expect }) => …)`, or a helper parameter passed that one.",
    },
  },
  create(context) {
    const namespaces = new Set<string>();
    return {
      ImportDeclaration(node): void {
        if (node.source.value !== 'vitest') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (
            specifier.type === AST_NODE_TYPES.ImportSpecifier &&
            specifier.imported.type === AST_NODE_TYPES.Identifier &&
            specifier.imported.name === 'expect'
          ) {
            context.report({ node: specifier, messageId: 'imported' });
          } else if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            namespaces.add(specifier.local.name);
          }
        }
      },
      MemberExpression(node): void {
        if (
          node.object.type === AST_NODE_TYPES.Identifier &&
          namespaces.has(node.object.name) &&
          !node.computed &&
          node.property.name === 'expect'
        ) {
          context.report({ node, messageId: 'notFromContext' });
        }
      },
      Identifier(node): void {
        if (node.name !== 'expect' || !isValueReference(node)) {
          return;
        }
        const variable = findVariable(context.sourceCode.getScope(node), node.name);
        const isImport = variable?.defs.some((definition) => {
          return definition.type === TSESLint.Scope.DefinitionType.ImportBinding;
        });
        const isParameter = variable?.defs.every((definition) => {
          return definition.type === TSESLint.Scope.DefinitionType.Parameter;
        });
        if (isImport !== true && isParameter !== true) {
          context.report({ node, messageId: 'notFromContext' });
        }
      },
    };
  },
});

function isValueReference(node: TSESTree.Identifier): boolean {
  const { parent } = node;
  switch (parent.type) {
    case AST_NODE_TYPES.MemberExpression: {
      return parent.object === node || parent.computed;
    }
    case AST_NODE_TYPES.Property: {
      return parent.value === node && parent.parent.type === AST_NODE_TYPES.ObjectExpression;
    }
    case AST_NODE_TYPES.ImportSpecifier:
    case AST_NODE_TYPES.ImportDefaultSpecifier:
    case AST_NODE_TYPES.ImportNamespaceSpecifier:
    case AST_NODE_TYPES.TSPropertySignature:
    case AST_NODE_TYPES.TSQualifiedName:
    case AST_NODE_TYPES.TSTypeReference:
    case AST_NODE_TYPES.TSTypeQuery: {
      return false;
    }
    default: {
      return !isDeclarationName(node);
    }
  }
}

function isDeclarationName(node: TSESTree.Identifier): boolean {
  const { parent } = node;
  return (
    (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.id === node) ||
    ((parent.type === AST_NODE_TYPES.FunctionDeclaration ||
      parent.type === AST_NODE_TYPES.FunctionExpression ||
      parent.type === AST_NODE_TYPES.ArrowFunctionExpression) &&
      parent.params.includes(node))
  );
}

function findVariable(
  start: TSESLint.Scope.Scope,
  name: string,
): TSESLint.Scope.Variable | undefined {
  let scope: TSESLint.Scope.Scope | null = start;
  while (scope !== null) {
    const variable = scope.set.get(name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
}
