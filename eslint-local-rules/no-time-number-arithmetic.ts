import { AST_NODE_TYPES, ESLintUtils, TSESLint } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';
import type ts from 'typescript';

type MessageIds =
  'arithmetic' | 'unitArithmetic' | 'comparison' | 'math' | 'nonSinkArgument' | 'nonSinkProperty';

interface Options {
  /** Calls that take a millisecond (or other raw time) number, written as their callee text. */
  readonly sinks?: readonly string[];
  /** Object-literal keys whose value may be a raw time number, such as an options `timeout`. */
  readonly sinkProperties?: readonly string[];
  /** Calls whose result is a raw time number, besides Temporal's escape hatches. */
  readonly sources?: readonly string[];
}

const defaultSinks = [
  'setTimeout',
  'setInterval',
  'AbortSignal.timeout',
  'Temporal.Instant.fromEpochMilliseconds',
  'Temporal.Instant.fromEpochNanoseconds',
  'String',
];
const defaultSinkProperties = ['timeout'];
const defaultSources = ['performance.now', 'Date.now'];

const durationUnits = new Set([
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
  'microseconds',
  'nanoseconds',
]);
const epochFields = new Set(['epochMilliseconds', 'epochNanoseconds', 'offsetNanoseconds']);
const unitConstants = new Set([
  '7',
  '24',
  '60',
  '1000',
  '3600',
  '86400',
  '604800',
  '60000',
  '3600000',
  '86400000',
  '604800000',
  '1000000',
  '1000000000',
]);
const whitespace = /\s+/gu;
const globalThisPrefix = /^globalThis\./u;
const arithmeticOperators = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '<<',
  '>>',
  '>>>',
  '&',
  '|',
  '^',
]);
const comparisonOperators = new Set(['<', '>', '<=', '>=', '==', '===', '!=', '!==']);

/**
 * Keeps raw time numbers out of the code (ADR 0059). A number read from a Temporal escape hatch
 * (`epochMilliseconds`, `epochNanoseconds`, a Duration unit field, `duration.total(unit)`) or from
 * `performance.now()` is tracked through local variables of the same function, and may only be
 * passed unchanged to a sink: a call in `sinks` (`setTimeout`, `AbortSignal.timeout`, …) or the
 * value of a key in `sinkProperties` (`timeout`). Arithmetic, comparison and `Math.*` on it, and
 * passing it to any other call, are reported with the Temporal API to use instead. Type-aware.
 */
export const noTimeNumberArithmetic = ESLintUtils.RuleCreator.withoutDocs<[Options], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid arithmetic on time-derived numbers; use Temporal' },
    schema: [
      {
        type: 'object',
        properties: {
          sinks: { type: 'array', items: { type: 'string' } },
          sinkProperties: { type: 'array', items: { type: 'string' } },
          sources: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{}],
    messages: {
      arithmetic:
        'Arithmetic on a time number ({{source}}). Stay in Temporal: `instant.add(duration)`, `a.until(b)`, `duration.add(other)`, `Temporal.Duration.from({ milliseconds })`, `duration.round({ smallestUnit })`.',
      unitArithmetic:
        "`{{operator}} {{constant}}` converts time units by hand ({{source}}). Use `duration.total('<unit>')`, `duration.round({ largestUnit, smallestUnit })` or `Temporal.Duration.from({ <unit>: n })`.",
      comparison:
        'Comparing a time number ({{source}}). Use `Temporal.Instant.compare(a, b)`, `Temporal.Duration.compare(a, b)` or `a.equals(b)`.',
      math: '`Math.{{name}}` on a time number ({{source}}). Use `duration.round({ smallestUnit, roundingMode })`, or pick with `Temporal.Duration.compare`.',
      nonSinkArgument:
        'A time number ({{source}}) is passed to `{{callee}}`, which is not a time sink. Pass a `Temporal.Instant` or `Temporal.Duration` instead, or list `{{callee}}` in `sinks`.',
      nonSinkProperty:
        'A time number ({{source}}) is stored as `{{key}}`, which is not a time sink. Store a Temporal value instead, or list `{{key}}` in `sinkProperties`.',
    },
  },
  create(context, [options]) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    const sinks = new Set([...defaultSinks, ...(options.sinks ?? [])]);
    const sinkProperties = new Set([...defaultSinkProperties, ...(options.sinkProperties ?? [])]);
    const sources = new Set([...defaultSources, ...(options.sources ?? [])]);
    const tracked = new Set<TSESLint.Scope.Variable>();

    const temporalTypeOf = (node: TSESTree.Node): string | undefined => {
      const type = checker
        .getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node))
        .getNonNullableType();
      return temporalName(checker, type);
    };

    const sourceLabel = (node: TSESTree.Node): string | undefined => {
      if (node.type === AST_NODE_TYPES.MemberExpression && !node.computed) {
        const field = node.property.name;
        const isField = epochFields.has(field) || durationUnits.has(field);
        const owner = isField ? temporalTypeOf(node.object) : undefined;
        if (owner === undefined) {
          return undefined;
        }
        if (owner !== 'Duration' && epochFields.has(field)) {
          return `${owner}#${field}`;
        }
        return owner === 'Duration' && durationUnits.has(field) ? `Duration#${field}` : undefined;
      }
      if (node.type === AST_NODE_TYPES.CallExpression) {
        const callee = calleeText(context, node.callee);
        if (sources.has(callee)) {
          return `${callee}()`;
        }
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          !node.callee.computed &&
          node.callee.property.name === 'total' &&
          temporalTypeOf(node.callee.object) === 'Duration'
        ) {
          return 'Duration#total()';
        }
      }
      return undefined;
    };

    const check = (node: TSESTree.Node, source: string): void => {
      let current = node;
      let { parent } = node;
      while (parent && isTransparent(parent, current)) {
        current = parent;
        parent = parent.parent;
      }
      if (!parent) {
        return;
      }
      switch (parent.type) {
        case AST_NODE_TYPES.VariableDeclarator: {
          if (parent.init === current) {
            track(context.sourceCode.getDeclaredVariables(parent), source);
          }
          return;
        }
        case AST_NODE_TYPES.AssignmentExpression: {
          if (parent.operator !== '=') {
            context.report({ node: parent, messageId: 'arithmetic', data: { source } });
          } else if (parent.right === current && parent.left.type === AST_NODE_TYPES.Identifier) {
            const variable = findVariable(context, parent.left);
            if (variable !== undefined) {
              track([variable], source);
            }
          }
          return;
        }
        case AST_NODE_TYPES.BinaryExpression: {
          reportBinary(parent, current, source);
          return;
        }
        case AST_NODE_TYPES.UnaryExpression: {
          if (parent.operator === '-' || parent.operator === '+' || parent.operator === '~') {
            context.report({ node: parent, messageId: 'arithmetic', data: { source } });
          }
          return;
        }
        case AST_NODE_TYPES.UpdateExpression: {
          context.report({ node: parent, messageId: 'arithmetic', data: { source } });
          return;
        }
        case AST_NODE_TYPES.CallExpression:
        case AST_NODE_TYPES.NewExpression: {
          if (!parent.arguments.includes(current as TSESTree.CallExpressionArgument)) {
            return;
          }
          const callee = calleeText(context, parent.callee);
          if (callee.startsWith('Math.')) {
            context.report({
              node: parent,
              messageId: 'math',
              data: { name: callee.slice(5), source },
            });
          } else if (!sinks.has(callee)) {
            context.report({
              node: current,
              messageId: 'nonSinkArgument',
              data: { callee, source },
            });
          }
          return;
        }
        case AST_NODE_TYPES.Property: {
          if (parent.value !== current || parent.parent.type !== AST_NODE_TYPES.ObjectExpression) {
            return;
          }
          const key = propertyName(parent);
          if (key === undefined || !sinkProperties.has(key)) {
            context.report({
              node: current,
              messageId: 'nonSinkProperty',
              data: { key: key ?? '[computed]', source },
            });
          }
          return;
        }
        default: {
          return;
        }
      }
    };

    const reportBinary = (
      parent: TSESTree.BinaryExpression,
      current: TSESTree.Node,
      source: string,
    ): void => {
      if (comparisonOperators.has(parent.operator)) {
        context.report({ node: parent, messageId: 'comparison', data: { source } });
        return;
      }
      if (!arithmeticOperators.has(parent.operator)) {
        return;
      }
      const other = parent.left === current ? parent.right : parent.left;
      const constant = unitConstantText(context, other);
      if (constant === undefined) {
        context.report({ node: parent, messageId: 'arithmetic', data: { source } });
      } else {
        context.report({
          node: parent,
          messageId: 'unitArithmetic',
          data: { operator: parent.operator, constant, source },
        });
      }
    };

    const track = (variables: readonly TSESLint.Scope.Variable[], source: string): void => {
      for (const variable of variables) {
        if (tracked.has(variable)) {
          continue;
        }
        tracked.add(variable);
        for (const reference of variable.references) {
          if (reference.isRead()) {
            check(reference.identifier, `${variable.name} from ${source}`);
          }
        }
      }
    };

    return {
      'MemberExpression, CallExpression'(
        node: TSESTree.MemberExpression | TSESTree.CallExpression,
      ): void {
        const source = sourceLabel(node);
        if (source !== undefined) {
          check(node, source);
        }
      },
    };
  },
});

function temporalName(checker: ts.TypeChecker, type: ts.Type): string | undefined {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol === undefined) {
    return undefined;
  }
  const name = checker.getFullyQualifiedName(symbol);
  return name.startsWith('Temporal.') ? name.slice('Temporal.'.length) : undefined;
}

function calleeText(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  callee: TSESTree.Node,
): string {
  return context.sourceCode
    .getText(callee)
    .replaceAll(whitespace, '')
    .replace(globalThisPrefix, '');
}

function isTransparent(parent: TSESTree.Node, child: TSESTree.Node): boolean {
  switch (parent.type) {
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
    case AST_NODE_TYPES.ChainExpression: {
      return true;
    }
    case AST_NODE_TYPES.ConditionalExpression: {
      return parent.test !== child;
    }
    case AST_NODE_TYPES.LogicalExpression: {
      return parent.operator !== '&&' || parent.right === child;
    }
    default: {
      return false;
    }
  }
}

function findVariable(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  node: TSESTree.Identifier,
): TSESLint.Scope.Variable | undefined {
  let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
}

function propertyName(property: TSESTree.Property): string | undefined {
  if (property.computed) {
    return undefined;
  }
  return property.key.type === AST_NODE_TYPES.Identifier
    ? property.key.name
    : String(property.key.value);
}

/** The source text of `node` when it is a time-unit constant: `1000`, `60 * 60 * 1000`, `1e3`, a `const` set to one. */
function unitConstantText(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  node: TSESTree.Node,
): string | undefined {
  return isUnitConstant(context, node, 0) ? context.sourceCode.getText(node) : undefined;
}

function isUnitConstant(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  node: TSESTree.Node,
  depth: number,
): boolean {
  if (depth > 4) {
    return false;
  }
  if (node.type === AST_NODE_TYPES.Literal) {
    return (
      (typeof node.value === 'number' || typeof node.value === 'bigint') &&
      unitConstants.has(node.value.toString())
    );
  }
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '*') {
    return (
      isUnitConstant(context, node.left, depth + 1) &&
      isUnitConstant(context, node.right, depth + 1)
    );
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const variable = findVariable(context, node);
    const definition = variable?.defs[0];
    return (
      definition?.type === TSESLint.Scope.DefinitionType.Variable &&
      definition.parent.kind === 'const' &&
      definition.node.init !== null &&
      isUnitConstant(context, definition.node.init, depth + 1)
    );
  }
  return false;
}
