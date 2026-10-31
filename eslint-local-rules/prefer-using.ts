import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';

type MessageIds = 'finallyOnlyReleases' | 'releasedByHand';

type FunctionNode =
  TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration | TSESTree.FunctionExpression;

/** Functions whose call releases what their first argument names. */
const releasingFunctions = new Set(['clearTimeout', 'clearInterval', 'rm', 'rmSync']);
/** Methods that release their receiver, or a listener or process it holds. */
const releasingMethods = new Set([
  'close',
  'dispose',
  'disposeAsync',
  'kill',
  'removeEventListener',
  'rm',
  'rmSync',
]);
/** Methods that release their receiver only when called bare: `tree.delete()`, not `map.delete(key)`. */
const bareReleasingMethods = new Set(['delete', 'remove']);
/** Methods that free a disposable value by hand, for `releasedByHand`. */
const disposingMethods = new Set(['close', 'dispose', 'disposeAsync']);
const disposeSymbols = new Set(['dispose', 'asyncDispose']);
const disposeSymbolName = /^__@(?:dispose|asyncDispose)@/u;
const functionTypes = new Set<string>([
  AST_NODE_TYPES.ArrowFunctionExpression,
  AST_NODE_TYPES.FunctionDeclaration,
  AST_NODE_TYPES.FunctionExpression,
]);

/**
 * Resources are released by `using` and `await using`, not by hand (ADR 0076). Reports:
 *
 * - `finallyOnlyReleases`: a `finally` block whose every statement releases something: a call to
 *   `clearTimeout`, `clearInterval`, `rm` or `rmSync`, or a method call `close()`, `dispose()`,
 *   `disposeAsync()`, `kill(…)`, `removeEventListener(…)`, `[Symbol.dispose]()`,
 *   `[Symbol.asyncDispose]()`, or an argument-less `delete()` or `remove()` (awaited, `void`ed or
 *   optional-chained alike). A `finally` that also does bookkeeping (`map.delete(key)`, a counter,
 *   an `if`) is left alone: `finally` is for bookkeeping.
 * - `releasedByHand` (type-aware): a `const` or `let` whose value has `Symbol.dispose` or
 *   `Symbol.asyncDispose`, which the same function frees by hand (`x.close()`, `x.dispose()`,
 *   `x.remove()`, `x.delete()`, `x[Symbol.dispose]()`, `clearTimeout(x)`, …) and which never
 *   escapes: every use is a member access in that function, so it is not returned, stored, passed
 *   on or captured by a closure that could outlive the scope.
 */
export const preferUsing = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Release resources with `using` instead of by hand' },
    schema: [],
    messages: {
      finallyOnlyReleases:
        'This `finally` only releases resources. Acquire them with `using` or `await using` (a `DisposableStack` for timers, listeners and processes) so every exit releases them; keep `finally` for bookkeeping (ADR 0076).',
      releasedByHand:
        '`{{name}}` is disposable and released by hand. Declare it with `{{keyword}}` instead (ADR 0076).',
    },
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      TryStatement(node): void {
        const body = node.finalizer?.body ?? [];
        if (body.length > 0 && body.every((statement) => isRelease(statement))) {
          context.report({ node: node.finalizer ?? node, messageId: 'finallyOnlyReleases' });
        }
      },
      VariableDeclarator(node): void {
        if (
          node.id.type !== AST_NODE_TYPES.Identifier ||
          node.init === null ||
          node.parent.kind === 'using' ||
          node.parent.kind === 'await using'
        ) {
          return;
        }
        const symbols = disposeSymbolsOf(checker, services.getTypeAtLocation(node.id));
        if (symbols.length === 0) {
          return;
        }
        const variable = context.sourceCode
          .getDeclaredVariables(node)
          .find((declared) => declared.name === (node.id as TSESTree.Identifier).name);
        const owner = enclosingFunction(node);
        if (variable === undefined || !isReleasedByHandOnly(variable, owner)) {
          return;
        }
        context.report({
          node: node.id,
          messageId: 'releasedByHand',
          data: {
            name: variable.name,
            keyword: usingKeyword(symbols),
          },
        });
      },
    };
  },
});

/** `using` when the value is synchronously disposable, else `await using`. */
function usingKeyword(symbols: readonly string[]): string {
  if (symbols.includes('dispose')) {
    return 'using';
  }
  return 'await using';
}

function isRelease(statement: TSESTree.Statement): boolean {
  if (statement.type !== AST_NODE_TYPES.ExpressionStatement) {
    return false;
  }
  const call = callIn(statement.expression);
  if (call === undefined) {
    return false;
  }
  const { callee } = call;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return releasingFunctions.has(callee.name);
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  if (isDisposeSymbol(callee)) {
    return true;
  }
  const name = propertyName(callee);
  return (
    name !== undefined &&
    (releasingMethods.has(name) || (bareReleasingMethods.has(name) && call.arguments.length === 0))
  );
}

/** The call an expression statement makes, through `await`, `void` and optional chaining. */
function callIn(expression: TSESTree.Expression): TSESTree.CallExpression | undefined {
  let current: TSESTree.Expression = expression;
  for (;;) {
    if (
      current.type === AST_NODE_TYPES.AwaitExpression ||
      (current.type === AST_NODE_TYPES.UnaryExpression && current.operator === 'void')
    ) {
      current = current.argument;
    } else if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
    } else {
      if (current.type === AST_NODE_TYPES.CallExpression) {
        return current;
      }
      return undefined;
    }
  }
}

function propertyName(member: TSESTree.MemberExpression): string | undefined {
  if (!member.computed && member.property.type === AST_NODE_TYPES.Identifier) {
    return member.property.name;
  }
  return undefined;
}

/** `x[Symbol.dispose]` or `x[Symbol.asyncDispose]`. */
function isDisposeSymbol(member: TSESTree.MemberExpression): boolean {
  const { property } = member;
  return (
    member.computed &&
    property.type === AST_NODE_TYPES.MemberExpression &&
    property.object.type === AST_NODE_TYPES.Identifier &&
    property.object.name === 'Symbol' &&
    property.property.type === AST_NODE_TYPES.Identifier &&
    disposeSymbols.has(property.property.name)
  );
}

/** `dispose` and/or `asyncDispose` when the (non-nullish part of the) type has those symbols. */
function disposeSymbolsOf(checker: ts.TypeChecker, type: ts.Type): string[] {
  const found = new Set<string>();
  const properties = checker.getPropertiesOfType(checker.getNonNullableType(type));
  for (const property of properties) {
    const name = String(property.escapedName);
    if (disposeSymbolName.test(name)) {
      if (name.startsWith('__@dispose@')) {
        found.add('dispose');
      } else {
        found.add('asyncDispose');
      }
    }
  }
  return [...found];
}

function enclosingFunction(node: TSESTree.Node): FunctionNode | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (functionTypes.has(current.type)) {
      return current as FunctionNode;
    }
  }
  return undefined;
}

/**
 * Every reference but the declaration is in `owner` itself (not a nested function) and reads a
 * member (`x.read()`) or is the argument of `clearTimeout`/`clearInterval`, and at least one
 * frees the value.
 */
function isReleasedByHandOnly(
  variable: TSESLint.Scope.Variable,
  owner: FunctionNode | undefined,
): boolean {
  let isFreed = false;
  for (const reference of variable.references) {
    if (reference.init === true) {
      continue;
    }
    const { identifier } = reference;
    if (enclosingFunction(identifier) !== owner) {
      return false;
    }
    const use = useOf(identifier as TSESTree.Identifier);
    if (use === 'escapes') {
      return false;
    }
    isFreed ||= use === 'frees';
  }
  return isFreed;
}

function useOf(identifier: TSESTree.Identifier): 'reads' | 'frees' | 'escapes' {
  const { parent } = identifier;
  if (
    parent.type === AST_NODE_TYPES.CallExpression &&
    parent.callee.type === AST_NODE_TYPES.Identifier &&
    (parent.callee.name === 'clearTimeout' || parent.callee.name === 'clearInterval') &&
    parent.arguments[0] === identifier
  ) {
    return 'frees';
  }
  if (parent.type !== AST_NODE_TYPES.MemberExpression || parent.object !== identifier) {
    return 'escapes';
  }
  const call = parent.parent;
  const isCalled = call.type === AST_NODE_TYPES.CallExpression && call.callee === parent;
  if (!isCalled) {
    return 'reads';
  }
  const name = propertyName(parent);
  const isFreeing =
    isDisposeSymbol(parent) ||
    (name !== undefined &&
      (disposingMethods.has(name) ||
        (bareReleasingMethods.has(name) && call.arguments.length === 0)));
  if (isFreeing) {
    return 'frees';
  }
  return 'reads';
}
