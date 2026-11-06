import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

import { cssDeclarationsFrom } from './css-declarations-from.ts';

type MessageIds =
  'colorLiteral' | 'fontSizeLiteral' | 'lengthLiteral' | 'lengthInString' | 'scaleToken';

const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/iu;
const absoluteLength = /(?:^|[\s/(])-?[\d.]+(?:px|rem|pt)\b/u;
const scaleToken = /var\(\s*--beuve-scale-/u;
/** A number with a CSS length unit (not `%` or `fr`, which divide what the container gives). */
const lengthLiteral =
  /(?<![\w.-])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vh|vw|vi|vb|vmin|vmax|svh|svw|lvh|lvw|dvh|dvw|ch|ex|ic|cap|lh|rlh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|cm|mm|in|q)\b/iu;

/**
 * Keeps the renderer on the design tokens in `src/ui/index.css` (ADR 0114). In Lit `css`
 * templates: no color literals (`#hex`, `rgb()`, `oklch()`, …), no lengths (`px`, `rem`, `em`,
 * `vh`, `ch`, … — sizes, spaces, borders and radii are tokens, and a text-sized width is a count
 * of `--beuve-measure-em`), and no `--beuve-scale-*` primitives, which only the token file's
 * semantic tier reads. In any other string or template (an `html` style attribute, CSS built as a
 * string, `setProperty`): no lengths either. `0`, `%`, `fr`, unitless numbers, `transparent`,
 * `currentColor` and `inherit` are fine; a length computed at run time is concatenated, not
 * written, so it never matches.
 */
export const cssDesignTokens = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Use design tokens for colors and lengths in the renderer' },
    schema: [],
    messages: {
      colorLiteral:
        '`{{property}}: {{value}}` has a color literal; use a semantic `--beuve-*` color token (ADR 0114).',
      fontSizeLiteral:
        '`{{property}}: {{value}}` has an absolute font size; use `--beuve-font-*` or `--beuve-font-size-*` (ADR 0114).',
      lengthLiteral:
        '`{{property}}: {{value}}` has a literal length; use a `--beuve-size-*`, `--beuve-space-*`, `--beuve-border-width*` or `--beuve-radius*` token, or a count of `--beuve-measure-em` (ADR 0114).',
      lengthInString:
        '`{{length}}` is a literal length; use a `--beuve-*` token through `var()` (ADR 0114).',
      scaleToken:
        '`{{property}}: {{value}}` reads a `--beuve-scale-*` primitive; use the semantic token built on it (ADR 0114).',
    },
  },
  create(context) {
    const reportLength = (node: TSESTree.Node, text: string): void => {
      const length = lengthLiteral.exec(text)?.[0];
      if (length !== undefined) {
        context.report({ node, messageId: 'lengthInString', data: { length } });
      }
    };
    return {
      TaggedTemplateExpression(node: TSESTree.TaggedTemplateExpression): void {
        if (!isCssTag(node)) {
          return;
        }
        for (const { property, value } of cssDeclarationsFrom(node.quasi)) {
          const messageId = messageIdFrom({ property, value });
          if (messageId !== undefined) {
            context.report({ node, messageId, data: { property, value } });
          }
        }
      },
      TemplateLiteral(node: TSESTree.TemplateLiteral): void {
        if (node.parent.type === AST_NODE_TYPES.TaggedTemplateExpression && isCssTag(node.parent)) {
          return;
        }
        for (const quasi of node.quasis) {
          reportLength(quasi, quasi.value.cooked ?? quasi.value.raw);
        }
      },
      Literal(node: TSESTree.Literal): void {
        if (typeof node.value === 'string') {
          reportLength(node, node.value);
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
  if (lengthLiteral.test(value)) {
    return 'lengthLiteral';
  }
  return undefined;
}

function isCssTag(node: TSESTree.TaggedTemplateExpression): boolean {
  return node.tag.type === AST_NODE_TYPES.Identifier && node.tag.name === 'css';
}
