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

    const expectedName = (isClass: boolean): string => {
      if (isClass) {
        return pascal;
      }
      return camel;
    };

    const check = ({ node, name, isClass }: RuntimeBinding): void => {
      const expected = expectedName(isClass);
      if (name !== expected) {
        context.report({ node, messageId: 'mismatch', data: { actual: name, expected } });
      }
    };

    return {
      ExportNamedDeclaration(node): void {
        if (node.exportKind === 'type' || node.source !== null) {
          return;
        }
        for (const binding of runtimeBindings(node)) {
          check(binding);
        }
      },
    };
  },
});

function camelCase(kebab: string): string {
  return kebab.replaceAll(/[-_]+([a-z\d])/giu, (_match, letter: string) => letter.toUpperCase());
}

interface RuntimeBinding {
  readonly node: TSESTree.Node;
  readonly name: string;
  readonly isClass: boolean;
}

function runtimeBindings(node: TSESTree.ExportNamedDeclaration): RuntimeBinding[] {
  const { declaration } = node;
  if (declaration === null) {
    return node.specifiers
      .filter((specifier) => specifier.exportKind !== 'type')
      .map((specifier) => {
        return {
          node: specifier.exported,
          name: exportedName(specifier.exported),
          isClass: false,
        };
      });
  }
  switch (declaration.type) {
    case AST_NODE_TYPES.ClassDeclaration:
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.TSDeclareFunction: {
      if (declaration.id === null || declaration.declare) {
        return [];
      }
      return [
        {
          node: declaration.id,
          name: declaration.id.name,
          isClass: declaration.type === AST_NODE_TYPES.ClassDeclaration,
        },
      ];
    }
    case AST_NODE_TYPES.VariableDeclaration: {
      if (declaration.declare) {
        return [];
      }
      return declaration.declarations.flatMap((declarator): RuntimeBinding[] | RuntimeBinding => {
        if (declarator.id.type !== AST_NODE_TYPES.Identifier) {
          return [];
        }
        return { node: declarator.id, name: declarator.id.name, isClass: isClassValue(declarator) };
      });
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

function exportedName(node: TSESTree.Identifier | TSESTree.StringLiteral): string {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  return node.value;
}

function isClassValue(declarator: TSESTree.VariableDeclarator): boolean {
  return declarator.init?.type === AST_NODE_TYPES.ClassExpression;
}
