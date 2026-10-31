import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

type MessageIds = 'noTernary';

const litTags = new Set(['html', 'svg']);
const litModule = /^lit(-html)?(\/|$)/u;

/**
 * Replaces core `no-ternary`: a conditional expression is allowed only in an expression slot of a
 * Lit `html` or `svg` template (text, attribute, property and boolean bindings), where it is the
 * idiom. A function inside the slot, such as a `.map` callback, is a boundary: the conditional in
 * it is reported. Nested conditionals are left to core `no-nested-ternary`.
 */
export const noTernaryOutsideTemplates = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid the conditional operator outside Lit template slots' },
    schema: [],
    messages: {
      noTernary:
        'Use `if`/`else`, an early return or a lookup instead of `?:`. Ternaries are allowed only directly in a Lit `html`/`svg` template slot.',
    },
  },
  create(context) {
    const imported = new Map<string, string>();
    const conditionals: TSESTree.ConditionalExpression[] = [];

    return {
      ImportDeclaration(node): void {
        for (const specifier of node.specifiers) {
          imported.set(specifier.local.name, node.source.value);
        }
      },
      ConditionalExpression(node): void {
        conditionals.push(node);
      },
      'Program:exit'(): void {
        for (const node of conditionals) {
          if (!isInLitSlot(node, imported)) {
            context.report({ node, messageId: 'noTernary' });
          }
        }
      },
    };
  },
});

function isInLitSlot(node: TSESTree.Node, imported: ReadonlyMap<string, string>): boolean {
  for (
    let current: TSESTree.Node | undefined = node.parent;
    current !== undefined && current.type !== AST_NODE_TYPES.Program;
    current = current.parent
  ) {
    if (
      current.type === AST_NODE_TYPES.FunctionDeclaration ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.StaticBlock
    ) {
      return false;
    }
    if (current.type === AST_NODE_TYPES.TemplateLiteral) {
      return isLitTemplate(current, imported);
    }
  }
  return false;
}

function isLitTemplate(
  template: TSESTree.TemplateLiteral,
  imported: ReadonlyMap<string, string>,
): boolean {
  const { parent } = template;
  if (parent.type !== AST_NODE_TYPES.TaggedTemplateExpression || parent.quasi !== template) {
    return false;
  }
  const { tag } = parent;
  if (tag.type !== AST_NODE_TYPES.Identifier || !litTags.has(tag.name)) {
    return false;
  }
  const source = imported.get(tag.name);
  return source === undefined || litModule.test(source);
}
