import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'noModuleMock' | 'noSpyOnImport';

const mockingMethods = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'hoisted',
  'importActual',
  'importMock',
]);

/**
 * Bans mocking modules (ADR 0058): what `@vitest/eslint-plugin`'s `no-restricted-vi-methods`
 * misses. `vi.spyOn` on an imported binding (`import fs from 'node:fs'; vi.spyOn(fs, …)`, or a
 * member of one) patches a module for every concurrent test, and `vi['mock']` and the `vitest.`
 * alias dodge the plugin. Inject the dependency instead.
 */
export const noModuleMocking = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid mocking module imports; inject dependencies' },
    schema: [],
    messages: {
      noModuleMock:
        '`vi.{{method}}` mocks a module. Pass the dependency in (a parameter or a deps object) instead.',
      noSpyOnImport:
        '`vi.spyOn` on the import `{{name}}` patches the module for every test. Inject the dependency instead.',
    },
  },
  create(context) {
    return {
      CallExpression(node): void {
        const { callee } = node;
        if (
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.object.type !== AST_NODE_TYPES.Identifier ||
          (callee.object.name !== 'vi' && callee.object.name !== 'vitest')
        ) {
          return;
        }
        const method = memberName(callee);
        if (method !== undefined && mockingMethods.has(method)) {
          context.report({ node, messageId: 'noModuleMock', data: { method } });
          return;
        }
        const [target] = node.arguments;
        if (method !== 'spyOn' || target === undefined) {
          return;
        }
        const root = rootIdentifier(target);
        if (root !== undefined && isImportBinding(context.sourceCode.getScope(node), root.name)) {
          context.report({ node, messageId: 'noSpyOnImport', data: { name: root.name } });
        }
      },
    };
  },
});

function memberName(node: TSESTree.MemberExpression): string | undefined {
  if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
    return node.property.name;
  }
  return node.property.type === AST_NODE_TYPES.Literal ? String(node.property.value) : undefined;
}

function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | undefined {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node;
  }
  return node.type === AST_NODE_TYPES.MemberExpression ? rootIdentifier(node.object) : undefined;
}

function isImportBinding(start: TSESLint.Scope.Scope, name: string): boolean {
  let scope: TSESLint.Scope.Scope | null = start;
  while (scope !== null) {
    const variable = scope.set.get(name);
    if (variable !== undefined) {
      return variable.defs.some((definition) => {
        return definition.type === TSESLint.Scope.DefinitionType.ImportBinding;
      });
    }
    scope = scope.upper;
  }
  return false;
}
