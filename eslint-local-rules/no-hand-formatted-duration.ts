import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'handFormatted';

const timeUnitNames = /(?:^|[a-z])(?:Ms|Millis|Milliseconds|Seconds|Secs)$/u;

/**
 * Durations shown to a person go through `formatDuration` (`#x/time/format-duration.ts`,
 * `Intl.DurationFormat`), not through `toFixed` on a number of seconds or milliseconds. Reports
 * `.toFixed(…)` whose receiver is, or does arithmetic on, `duration.total('…')` or a name that
 * ends in `Ms`, `Milliseconds` or `Seconds`.
 */
export const noHandFormattedDuration = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Format durations with Intl.DurationFormat, not toFixed' },
    schema: [],
    messages: {
      handFormatted:
        '`toFixed` on {{source}} builds duration text by hand. Keep a `Temporal.Duration` and show it with `formatDuration(duration)` from `#x/time/format-duration.ts`.',
    },
  },
  create(context) {
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="toFixed"]'(
        node: TSESTree.CallExpression,
      ): void {
        const { callee } = node;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        const source = timeSourceIn(callee.object);
        if (source !== undefined) {
          context.report({ node, messageId: 'handFormatted', data: { source } });
        }
      },
    };
  },
});

function timeSourceIn(start: TSESTree.Node): string | undefined {
  let node = start;
  while (node.type === AST_NODE_TYPES.ChainExpression) {
    node = node.expression;
  }
  switch (node.type) {
    case AST_NODE_TYPES.BinaryExpression: {
      return timeSourceIn(node.left) ?? timeSourceIn(node.right);
    }
    case AST_NODE_TYPES.CallExpression: {
      return isTotalCall(node) ? '`duration.total(…)`' : undefined;
    }
    case AST_NODE_TYPES.Identifier: {
      return timeUnitNames.test(node.name) ? `\`${node.name}\`` : undefined;
    }
    case AST_NODE_TYPES.MemberExpression: {
      return !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        timeUnitNames.test(node.property.name)
        ? `\`${node.property.name}\``
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

function isTotalCall(node: TSESTree.CallExpression): boolean {
  return (
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    !node.callee.computed &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    node.callee.property.name === 'total'
  );
}
