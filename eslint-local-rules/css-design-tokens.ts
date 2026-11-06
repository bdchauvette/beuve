import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

import { cssDeclarationsFrom } from './css-declarations-from.ts';

type MessageIds = 'colorLiteral' | 'fontSizeLiteral' | 'scaleToken';

const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/iu;
const absoluteLength = /(?:^|[\s/(])-?[\d.]+(?:px|rem|pt)\b/u;
const scaleToken = /var\(\s*--beuve-scale-/u;

/**
 * Keeps Lit `css` templates on the design tokens in `src/ui/index.css` (ADR 0114): no color
 * literals (`#hex`, `rgb()`, `oklch()`, …), no absolute font sizes in `font-size` or `font`
 * (`em` and `%` are fine), and no `--beuve-scale-*` primitives, which only the token file's
 * semantic tier reads. `transparent`, `currentColor` and `inherit` are not literals.
 */
export const cssDesignTokens = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Use design tokens for colors and font sizes in Lit css templates' },
    schema: [],
    messages: {
      colorLiteral:
        '`{{property}}: {{value}}` has a color literal; use a semantic `--beuve-*` color token (ADR 0114).',
      fontSizeLiteral:
        '`{{property}}: {{value}}` has an absolute font size; use `--beuve-font-*` or `--beuve-font-size-*` (ADR 0114).',
      scaleToken:
        '`{{property}}: {{value}}` reads a `--beuve-scale-*` primitive; use the semantic token built on it (ADR 0114).',
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node: TSESTree.TaggedTemplateExpression): void {
        if (node.tag.type !== AST_NODE_TYPES.Identifier || node.tag.name !== 'css') {
          return;
        }
        for (const { property, value } of cssDeclarationsFrom(node.quasi)) {
          const messageId = messageIdFrom({ property, value });
          if (messageId !== undefined) {
            context.report({ node, messageId, data: { property, value } });
          }
        }
      },
    };
  },
});

interface Declaration {
  readonly property: string;
  readonly value: string;
}

function messageIdFrom({ property, value }: Declaration): MessageIds | undefined {
  if (scaleToken.test(value)) {
    return 'scaleToken';
  }
  if (colorLiteral.test(value)) {
    return 'colorLiteral';
  }
  const isFontSize = property === 'font' || property.includes('font-size');
  if (isFontSize && absoluteLength.test(value)) {
    return 'fontSizeLiteral';
  }
  return undefined;
}
