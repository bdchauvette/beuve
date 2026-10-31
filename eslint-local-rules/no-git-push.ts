import { ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'push' | 'reviewRef';

const publishingSubcommands = new Set(['push', 'send-pack', 'http-push']);
const reviewRefPrefix = 'refs/heads/review/';

/**
 * beuve never pushes (ADR 0088). Reports a string or template part that is exactly a git
 * subcommand that publishes refs (`push`, `send-pack`, `http-push`), and any that names a
 * review-edits branch by its full ref (`refs/heads/review/…`), outside tests. The runner's
 * allow-list (`gitSubcommands`) refuses such a command at run time; this keeps one from being
 * written in the first place. Superseding ADR 0088 is the only way to lift it.
 */
export const noGitPush = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid git push and full refs of review-edits branches' },
    schema: [],
    messages: {
      push: 'beuve never pushes (ADR 0088): no git subcommand that publishes refs.',
      reviewRef:
        "Review-edits branches stay local (ADR 0088): don't name `refs/heads/review/…`; take the branch from its ownership record.",
    },
  },
  create(context) {
    const check = (node: TSESTree.Node, text: string): void => {
      if (publishingSubcommands.has(text)) {
        context.report({ node, messageId: 'push' });
      } else if (text.includes(reviewRefPrefix)) {
        context.report({ node, messageId: 'reviewRef' });
      }
    };
    return {
      Literal(node): void {
        if (typeof node.value === 'string') {
          check(node, node.value);
        }
      },
      TemplateElement(node): void {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
});
