import { ASTUtils, AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'checkThenOpen';

const fsModules = new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises']);

/** Calls that look at a path without keeping what they found. */
const checks = new Set([
  'access',
  'accessSync',
  'existsSync',
  'lstat',
  'lstatSync',
  'realpath',
  'realpathSync',
  'stat',
  'statSync',
]);

/** Calls that act on a path, opening it again. */
const uses = new Set([
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'copyFile',
  'copyFileSync',
  'createReadStream',
  'createWriteStream',
  'open',
  'openSync',
  'readFile',
  'readFileSync',
  'rm',
  'rmSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
]);

const functionTypes = new Set<string>([
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
]);

interface Check {
  readonly name: string;
  readonly owner: TSESTree.Node;
  readonly variable: TSESLint.Scope.Variable;
}

/**
 * No path-based check followed by a path-based open of the same variable in one function (ADR
 * 0081): `stat(file)` then `readFile(file)` reads whatever `file` names by then, which a rename
 * or symlink swap in between can change. Open once and ask the handle (`handle.stat()`,
 * `handle.readFile()`). Only `node:fs` and `node:fs/promises` functions count, imported by name
 * or reached through a namespace or default import.
 */
export const noCheckThenOpen = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow checking a path and then opening it again by path' },
    schema: [],
    messages: {
      checkThenOpen:
        '`{{use}}({{path}})` after `{{check}}({{path}})` in the same function acts on whatever `{{path}}` names by then. Open it once and check the handle (`handle.stat()`, `handle.readFile()`), ADR 0082.',
    },
  },
  create(context) {
    const named = new Map<string, string>();
    const namespaces = new Set<string>();
    const seen: Check[] = [];

    const fsName = (callee: TSESTree.Expression): string | undefined => {
      if (callee.type === AST_NODE_TYPES.Identifier) {
        return named.get(callee.name);
      }
      if (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier
      ) {
        const { object } = callee;
        if (object.type === AST_NODE_TYPES.Identifier && namespaces.has(object.name)) {
          return callee.property.name;
        }
        if (
          object.type === AST_NODE_TYPES.MemberExpression &&
          !object.computed &&
          object.object.type === AST_NODE_TYPES.Identifier &&
          namespaces.has(object.object.name) &&
          object.property.type === AST_NODE_TYPES.Identifier &&
          object.property.name === 'promises'
        ) {
          return callee.property.name;
        }
      }
      return undefined;
    };

    const ownerOf = (node: TSESTree.Node): TSESTree.Node =>
      context.sourceCode
        .getAncestors(node)
        .findLast((ancestor) => functionTypes.has(ancestor.type)) ?? context.sourceCode.ast;

    return {
      ImportDeclaration(node): void {
        if (!fsModules.has(node.source.value)) {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
            const imported =
              specifier.imported.type === AST_NODE_TYPES.Identifier
                ? specifier.imported.name
                : specifier.imported.value;
            named.set(specifier.local.name, imported);
          } else {
            namespaces.add(specifier.local.name);
          }
        }
      },
      CallExpression(node): void {
        if (node.callee.type === AST_NODE_TYPES.Super) {
          return;
        }
        const name = fsName(node.callee);
        const [first] = node.arguments;
        if (name === undefined || first?.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        const variable = ASTUtils.findVariable(context.sourceCode.getScope(first), first);
        if (variable === null) {
          return;
        }
        const owner = ownerOf(node);
        if (checks.has(name)) {
          seen.push({ name, owner, variable });
          return;
        }
        if (!uses.has(name)) {
          return;
        }
        const check = seen.find((entry) => entry.owner === owner && entry.variable === variable);
        if (check !== undefined) {
          context.report({
            node,
            messageId: 'checkThenOpen',
            data: { use: name, check: check.name, path: first.name },
          });
        }
      },
    };
  },
});
