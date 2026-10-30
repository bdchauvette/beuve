import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'notSequential' | 'outsideTest';

interface Options {
  /** Fixtures that fake time while a test uses them. */
  readonly fixtures?: readonly string[];
}

const fakeTimeMethods = new Set(['useFakeTimers', 'setSystemTime']);
const testNames = new Set(['test', 'it']);
const suiteNames = new Set(['describe', 'suite']);

/**
 * Fake time is global to a test file, so a test that fakes it must not run concurrently with the
 * others (ADR 0058). A test that calls `vi.useFakeTimers()`/`vi.setSystemTime()`, or takes a
 * time-faking fixture such as `clock`, must be declared `test('…', { concurrent: false }, …)`,
 * or sit in a `describe('…', { concurrent: false }, …)`. Fake-time calls outside a test are
 * reported too: use the fixture.
 */
export const requireSequentialFakeTime = ESLintUtils.RuleCreator.withoutDocs<[Options], MessageIds>(
  {
    meta: {
      type: 'problem',
      docs: { description: 'Require tests that fake time to opt out of concurrency' },
      schema: [
        {
          type: 'object',
          properties: { fixtures: { type: 'array', items: { type: 'string' } } },
          additionalProperties: false,
        },
      ],
      defaultOptions: [{ fixtures: ['clock'] }],
      messages: {
        notSequential:
          "This test fakes time ({{how}}), which is global to the file: declare it `test('…', { concurrent: false }, …)`.",
        outsideTest:
          '`vi.{{method}}()` outside a test leaks fake time into concurrent tests. Use the `clock` fixture in a `{ concurrent: false }` test.',
      },
    },
    create(context, [options]) {
      const fixtures = new Set(options.fixtures ?? ['clock']);

      const requireSequential = (call: TSESTree.CallExpression, how: string): void => {
        if (!isNonConcurrent(call) && !hasNonConcurrentSuite(call)) {
          context.report({ node: call, messageId: 'notSequential', data: { how } });
        }
      };

      return {
        CallExpression(node): void {
          const method = fakeTimeMethod(node);
          if (method !== undefined) {
            const testCall = enclosingTestCall(node);
            if (testCall === undefined) {
              context.report({ node, messageId: 'outsideTest', data: { method } });
            } else {
              requireSequential(testCall, `vi.${method}()`);
            }
            return;
          }
          if (!isTestCall(node)) {
            return;
          }
          const fixture = usedFixture(node, fixtures);
          if (fixture !== undefined) {
            requireSequential(node, `the \`${fixture}\` fixture`);
          }
        },
      };
    },
  },
);

function fakeTimeMethod(node: TSESTree.CallExpression): string | undefined {
  const { callee } = node;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.object.type !== AST_NODE_TYPES.Identifier ||
    (callee.object.name !== 'vi' && callee.object.name !== 'vitest')
  ) {
    return undefined;
  }
  const name =
    callee.property.type === AST_NODE_TYPES.Identifier && !callee.computed
      ? callee.property.name
      : callee.property.type === AST_NODE_TYPES.Literal
        ? String(callee.property.value)
        : undefined;
  return name !== undefined && fakeTimeMethods.has(name) ? name : undefined;
}

function rootName(node: TSESTree.Node): string | undefined {
  let current: TSESTree.Node | undefined = node;
  while (current !== undefined && current.type !== AST_NODE_TYPES.Identifier) {
    current = innerOf(current);
  }
  return current?.name;
}

function innerOf(node: TSESTree.Node): TSESTree.Node | undefined {
  switch (node.type) {
    case AST_NODE_TYPES.MemberExpression: {
      return node.object;
    }
    case AST_NODE_TYPES.CallExpression: {
      return node.callee;
    }
    case AST_NODE_TYPES.TaggedTemplateExpression: {
      return node.tag;
    }
    default: {
      return undefined;
    }
  }
}

function isTestCall(node: TSESTree.CallExpression): boolean {
  const name = rootName(node.callee);
  return name !== undefined && testNames.has(name) && callbackOf(node) !== undefined;
}

function callbackOf(
  node: TSESTree.CallExpression,
): TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | undefined {
  return node.arguments.find(
    (argument): argument is TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression =>
      argument.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      argument.type === AST_NODE_TYPES.FunctionExpression,
  );
}

function enclosingTestCall(node: TSESTree.Node): TSESTree.CallExpression | undefined {
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (current.type === AST_NODE_TYPES.CallExpression && isTestCall(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function usedFixture(
  node: TSESTree.CallExpression,
  fixtures: ReadonlySet<string>,
): string | undefined {
  const [parameter] = callbackOf(node)?.params ?? [];
  if (parameter?.type !== AST_NODE_TYPES.ObjectPattern) {
    return undefined;
  }
  for (const property of parameter.properties) {
    if (
      property.type === AST_NODE_TYPES.Property &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      fixtures.has(property.key.name)
    ) {
      return property.key.name;
    }
  }
  return undefined;
}

function isNonConcurrent(node: TSESTree.CallExpression): boolean {
  return node.arguments.some(
    (argument) =>
      argument.type === AST_NODE_TYPES.ObjectExpression &&
      argument.properties.some(
        (property) =>
          property.type === AST_NODE_TYPES.Property &&
          property.key.type === AST_NODE_TYPES.Identifier &&
          property.key.name === 'concurrent' &&
          property.value.type === AST_NODE_TYPES.Literal &&
          property.value.value === false,
      ),
  );
}

function hasNonConcurrentSuite(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent;
  while (current) {
    if (current.type === AST_NODE_TYPES.CallExpression) {
      const name = rootName(current.callee);
      if (name !== undefined && suiteNames.has(name) && isNonConcurrent(current)) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}
