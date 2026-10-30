import { ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'noModuleScopeBinding';

/**
 * Forbids `const`, `let` and `var` at the top level of a test file (ADR 0058): concurrent tests
 * would share them. Per-test values come from fixtures (`test.extend`), shared read-only data
 * from a `testing/` module or a fixture. Imports, types and `function` declarations stay allowed.
 */
export const noModuleScopeBindings = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'problem',
    docs: { description: 'Forbid module-scope variables in test files; use fixtures' },
    schema: [],
    messages: {
      noModuleScopeBinding:
        '`{{kind}}` at the top of a test file is shared by every test in it. Move it into the test, into a fixture (`test.extend`), or into a `testing/` module.',
    },
  },
  create(context) {
    const report = (node: TSESTree.VariableDeclaration): void => {
      context.report({ node, messageId: 'noModuleScopeBinding', data: { kind: node.kind } });
    };
    return {
      'Program > VariableDeclaration'(node: TSESTree.VariableDeclaration): void {
        report(node);
      },
      'Program > ExportNamedDeclaration > VariableDeclaration'(
        node: TSESTree.VariableDeclaration,
      ): void {
        report(node);
      },
    };
  },
});
