import path from 'node:path';

import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'mismatch';

/**
 * The runtime export of `create-logger.ts` is `createLogger`; of `lru-cache.ts`, the class
 * `LruCache` (ADR 0002). Type exports are not checked.
 */
export const exportNameMatchesFilename = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Require the runtime export to be named after the kebab-case file' },
    schema: [],
    messages: {
      mismatch: 'Export "{{actual}}" should be named "{{expected}}" to match its file name.',
    },
  },
  create(context) {
    const stem = path.basename(context.filename).split('.', 1)[0] ?? '';
    const camel = camelCase(stem);
    const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);

    const check = (node: TSESTree.Node, name: string, isClass: boolean): void => {
      const expected = isClass ? pascal : camel;
      if (name !== expected) {
        context.report({ node, messageId: 'mismatch', data: { actual: name, expected } });
      }
    };

    return {
      ExportNamedDeclaration(node): void {
        if (node.exportKind === 'type' || node.source !== null) {
          return;
        }
        for (const { node: target, name, isClass } of runtimeBindings(node)) {
          check(target, name, isClass);
        }
      },
    };
  },
});

function camelCase(kebab: string): string {
  return kebab.replaceAll(/[-_]+([a-z\d])/giu, (_match, letter: string) => letter.toUpperCase());
}

function runtimeBindings(
  node: TSESTree.ExportNamedDeclaration,
): { node: TSESTree.Node; name: string; isClass: boolean }[] {
  const { declaration } = node;
  if (declaration === null) {
    return node.specifiers
      .filter((specifier) => specifier.exportKind !== 'type')
      .map((specifier) => ({
        node: specifier.exported,
        name:
          specifier.exported.type === AST_NODE_TYPES.Identifier
            ? specifier.exported.name
            : specifier.exported.value,
        isClass: false,
      }));
  }
  switch (declaration.type) {
    case AST_NODE_TYPES.ClassDeclaration:
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.TSDeclareFunction: {
      return declaration.id === null || declaration.declare
        ? []
        : [
            {
              node: declaration.id,
              name: declaration.id.name,
              isClass: declaration.type === AST_NODE_TYPES.ClassDeclaration,
            },
          ];
    }
    case AST_NODE_TYPES.VariableDeclaration: {
      return declaration.declare
        ? []
        : declaration.declarations
            .filter((declarator) => declarator.id.type === AST_NODE_TYPES.Identifier)
            .map((declarator) => ({
              node: declarator.id,
              name: declarator.id.type === AST_NODE_TYPES.Identifier ? declarator.id.name : '',
              isClass: isClassValue(declarator),
            }));
    }
    case AST_NODE_TYPES.TSEnumDeclaration:
    case AST_NODE_TYPES.TSImportEqualsDeclaration:
    case AST_NODE_TYPES.TSInterfaceDeclaration:
    case AST_NODE_TYPES.TSModuleDeclaration:
    case AST_NODE_TYPES.TSTypeAliasDeclaration: {
      return [];
    }
  }
}

function isClassValue(declarator: TSESTree.VariableDeclarator): boolean {
  return declarator.init?.type === AST_NODE_TYPES.ClassExpression;
}
