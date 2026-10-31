import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type Options = [{ allowNoExports?: boolean }];
type MessageIds = 'noDefaultExport' | 'tooManyExports' | 'missingExport';

/**
 * Each module exports exactly one runtime value and no default export (ADR 0002).
 * Type-only exports are unrestricted and don't count.
 */
export const enforceSingleNamedExport = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: 'problem',
    docs: {
      description: 'Require exactly one runtime named export per module and forbid default exports',
    },
    schema: [
      {
        type: 'object',
        properties: { allowNoExports: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowNoExports: false }],
    messages: {
      noDefaultExport: 'Default exports are not allowed; export one named value instead.',
      tooManyExports:
        'Only one runtime export per module is allowed (ADR 0002); move "{{name}}" to its own file.',
      missingExport:
        'A module must export exactly one runtime value or only types; this one exports nothing.',
    },
  },
  create(context, [{ allowNoExports = false }]) {
    const runtimeExports: { name: string; node: TSESTree.Node }[] = [];
    let typeExportCount = 0;

    const recordDeclaration = (node: TSESTree.ExportNamedDeclaration): void => {
      const { declaration } = node;
      if (declaration === null) {
        for (const specifier of node.specifiers) {
          if (node.exportKind === 'type' || specifier.exportKind === 'type') {
            typeExportCount += 1;
          } else {
            runtimeExports.push({ name: exportedName(specifier.exported), node: specifier });
          }
        }
        return;
      }
      if (isTypeOnlyDeclaration(declaration)) {
        typeExportCount += 1;
        return;
      }
      for (const name of declaredNames(declaration)) {
        runtimeExports.push({ name, node: declaration });
      }
    };

    return {
      ExportDefaultDeclaration(node): void {
        context.report({ node, messageId: 'noDefaultExport' });
      },
      TSExportAssignment(node): void {
        context.report({ node, messageId: 'noDefaultExport' });
      },
      ExportAllDeclaration(node): void {
        if (node.exportKind === 'type') {
          typeExportCount += 1;
          return;
        }
        runtimeExports.push({
          name: node.exported === null ? '*' : exportedName(node.exported),
          node,
        });
      },
      ExportNamedDeclaration: recordDeclaration,
      'Program:exit'(program): void {
        for (const extra of runtimeExports.slice(1)) {
          context.report({
            node: extra.node,
            messageId: 'tooManyExports',
            data: { name: extra.name },
          });
        }
        const isEmptyModule = runtimeExports.length === 0 && typeExportCount === 0;
        if (isEmptyModule && !allowNoExports && !hasDefaultExport(program)) {
          context.report({
            node: program,
            loc: { line: 1, column: 0 },
            messageId: 'missingExport',
          });
        }
      },
    };
  },
});

function isTypeOnlyDeclaration(declaration: TSESTree.NamedExportDeclarations): boolean {
  switch (declaration.type) {
    case AST_NODE_TYPES.TSInterfaceDeclaration:
    case AST_NODE_TYPES.TSTypeAliasDeclaration: {
      return true;
    }
    case AST_NODE_TYPES.ClassDeclaration:
    case AST_NODE_TYPES.FunctionDeclaration:
    case AST_NODE_TYPES.TSDeclareFunction:
    case AST_NODE_TYPES.TSEnumDeclaration:
    case AST_NODE_TYPES.TSImportEqualsDeclaration:
    case AST_NODE_TYPES.TSModuleDeclaration:
    case AST_NODE_TYPES.VariableDeclaration: {
      return 'declare' in declaration && declaration.declare;
    }
  }
}

function declaredNames(declaration: TSESTree.NamedExportDeclarations): string[] {
  if (declaration.type === AST_NODE_TYPES.VariableDeclaration) {
    return declaration.declarations.map((declarator) => {
      return declarator.id.type === AST_NODE_TYPES.Identifier ? declarator.id.name : '{…}';
    });
  }
  if ('id' in declaration && declaration.id?.type === AST_NODE_TYPES.Identifier) {
    return [declaration.id.name];
  }
  return ['<anonymous>'];
}

function exportedName(node: TSESTree.Identifier | TSESTree.StringLiteral): string {
  return node.type === AST_NODE_TYPES.Identifier ? node.name : node.value;
}

function hasDefaultExport(program: TSESTree.Program): boolean {
  return program.body.some((statement) => {
    return (
      statement.type === AST_NODE_TYPES.ExportDefaultDeclaration ||
      statement.type === AST_NODE_TYPES.TSExportAssignment
    );
  });
}
