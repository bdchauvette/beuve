import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'noExportAll' | 'noReExport' | 'noImportedReExport';

/**
 * Forbids re-exports so every import names the exact file that defines the symbol (ADR 0002).
 */
export const noBarrelFiles = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid re-exports (barrel files); import from the defining file' },
    schema: [],
    messages: {
      noExportAll: '`export * from` creates a barrel; import from the defining file instead.',
      noReExport: 'Re-exporting from "{{source}}" creates a barrel; import from it directly.',
      noImportedReExport:
        '"{{name}}" is imported and re-exported; consumers should import it from its source.',
    },
  },
  create(context) {
    const reportImportedSpecifiers = (node: TSESTree.ExportNamedDeclaration): void => {
      const scope = context.sourceCode.getScope(node);
      for (const specifier of node.specifiers) {
        if (specifier.local.type !== AST_NODE_TYPES.Identifier) {
          continue;
        }
        if (isImportBinding(scope, specifier.local.name)) {
          context.report({
            node: specifier,
            messageId: 'noImportedReExport',
            data: { name: specifier.local.name },
          });
        }
      }
    };

    return {
      ExportAllDeclaration(node): void {
        context.report({ node, messageId: 'noExportAll' });
      },
      ExportNamedDeclaration(node): void {
        if (node.source !== null) {
          context.report({ node, messageId: 'noReExport', data: { source: node.source.value } });
          return;
        }
        reportImportedSpecifiers(node);
      },
    };
  },
});

function isImportBinding(scope: TSESLint.Scope.Scope, name: string): boolean {
  let current: TSESLint.Scope.Scope | null = scope;
  while (current !== null) {
    const variable = current.set.get(name);
    if (variable !== undefined) {
      return variable.defs.some(
        (definition) => definition.type === TSESLint.Scope.DefinitionType.ImportBinding,
      );
    }
    current = current.upper;
  }
  return false;
}
