import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'runAsNode' | 'fork';

const variable = 'ELECTRON_RUN_AS_NODE';
const childProcessModules = new Set(['node:child_process', 'child_process']);

/**
 * Bans running Electron as Node (ADR 0083): the `runAsNode` fuse is off, so
 * `ELECTRON_RUN_AS_NODE` starts the app instead, and `child_process.fork` throws in a packaged
 * app. Node children run the Node from `resolveNodeRuntime` with a plain `spawn`. Reports the
 * variable's name in any string, template or identifier, and `fork` from `child_process`, whether
 * imported by name or read off a default or namespace import.
 */
export const noElectronAsNode = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid ELECTRON_RUN_AS_NODE and child_process.fork' },
    schema: [],
    messages: {
      runAsNode:
        "The runAsNode fuse is off, so `ELECTRON_RUN_AS_NODE` doesn't make Electron a Node. Spawn the Node from `resolveNodeRuntime` (ADR 0083).",
      fork: '`child_process.fork` runs `process.execPath`, which is Electron and throws with the runAsNode fuse off. `spawn` the Node from `resolveNodeRuntime` instead (ADR 0083).',
    },
  },
  create(context) {
    const moduleNames = new Set<string>();
    const reportText = (node: TSESTree.Node, text: string): void => {
      if (text.includes(variable)) {
        context.report({ node, messageId: 'runAsNode' });
      }
    };
    return {
      Literal(node): void {
        if (typeof node.value === 'string') {
          reportText(node, node.value);
        }
      },
      TemplateElement(node): void {
        reportText(node, node.value.raw);
      },
      Identifier(node): void {
        if (node.name === variable) {
          context.report({ node, messageId: 'runAsNode' });
        }
      },
      ImportDeclaration(node): void {
        if (!childProcessModules.has(node.source.value)) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) {
            moduleNames.add(specifier.local.name);
          } else if (importedName(specifier) === 'fork') {
            context.report({ node: specifier, messageId: 'fork' });
          }
        }
      },
      MemberExpression(node): void {
        if (
          node.object.type === AST_NODE_TYPES.Identifier &&
          moduleNames.has(node.object.name) &&
          propertyName(node) === 'fork'
        ) {
          context.report({ node, messageId: 'fork' });
        }
      },
    };
  },
});

function importedName(specifier: TSESTree.ImportSpecifier): string {
  return specifier.imported.type === AST_NODE_TYPES.Identifier
    ? specifier.imported.name
    : specifier.imported.value;
}

function propertyName(node: TSESTree.MemberExpression): string | undefined {
  if (!node.computed) {
    return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : undefined;
  }
  return node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === 'string'
    ? node.property.value
    : undefined;
}
