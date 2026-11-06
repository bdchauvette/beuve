import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils';
import type { TSESTree } from '@typescript-eslint/utils';

import { cssDeclarationsFrom } from './css-declarations-from.ts';
import type { CssDeclaration } from './css-declarations-from.ts';

type MessageIds = 'physicalProperty' | 'physicalValue' | 'asymmetricShorthand';

/** A physical declaration and the logical one to write instead. */
interface Finding {
  readonly messageId: MessageIds;
  readonly found: string;
  readonly logical: string;
}

const sides: Readonly<Record<string, string>> = {
  top: 'block-start',
  bottom: 'block-end',
  left: 'inline-start',
  right: 'inline-end',
};
const sizes: Readonly<Record<string, string>> = { width: 'inline-size', height: 'block-size' };
const corners: Readonly<Record<string, string>> = {
  'top-left': 'start-start',
  'top-right': 'start-end',
  'bottom-left': 'end-start',
  'bottom-right': 'end-end',
};
const sidedValues: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'text-align': { left: 'start', right: 'end' },
  float: { left: 'inline-start', right: 'inline-end' },
  clear: { left: 'inline-start', right: 'inline-end' },
  resize: { horizontal: 'inline', vertical: 'block' },
};
const sidedProperty =
  /^((?:scroll-)?(?:margin|padding)|border)-(top|bottom|left|right)(-(?:width|style|color))?$/u;
const cornerProperty = /^border-((?:top|bottom)-(?:left|right))-radius$/u;
const sizeProperty = /^(min-|max-|contain-intrinsic-)?(width|height)$/u;
const borderShorthand = /^border-(width|style|color)$/u;
const whitespace = /\s/u;
const boxShorthands: ReadonlySet<string> = new Set([
  'margin',
  'padding',
  'inset',
  'scroll-margin',
  'scroll-padding',
  'border-width',
  'border-style',
  'border-color',
]);

/**
 * Keeps Lit `css` templates on logical properties (ADR 0114): `margin-inline-start`, not
 * `margin-left`; `inset-block-start`, not `top`; `inline-size`, not `width`; `text-align: start`.
 * A four-value box shorthand whose left and right differ (`padding: 0 0 0 8px`) becomes
 * `padding-block` and `padding-inline`, and a border radius whose corners differ across the inline
 * axis becomes the `border-start-start-radius` family; shorthands that mirror left and right stay.
 * `overflow-x`/`-y` are allowed: Chromium has no logical overflow yet.
 */
export const cssLogicalProperties = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: 'suggestion',
    docs: { description: 'Use logical CSS properties in Lit css templates' },
    schema: [],
    messages: {
      physicalProperty: 'Use the logical `{{logical}}` instead of `{{found}}` (ADR 0114).',
      physicalValue: 'Use the logical `{{logical}}` instead of `{{found}}` (ADR 0114).',
      asymmetricShorthand:
        '`{{found}}` sets left and right differently; use {{logical}} (ADR 0114).',
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node: TSESTree.TaggedTemplateExpression): void {
        if (node.tag.type !== AST_NODE_TYPES.Identifier || node.tag.name !== 'css') {
          return;
        }
        for (const declaration of cssDeclarationsFrom(node.quasi)) {
          const finding = findingFrom(declaration);
          if (finding !== undefined) {
            context.report({
              node,
              messageId: finding.messageId,
              data: { found: finding.found, logical: finding.logical },
            });
          }
        }
      },
    };
  },
});

function findingFrom(declaration: CssDeclaration): Finding | undefined {
  return (
    physicalPropertyFrom(declaration.property) ??
    physicalValueFrom(declaration) ??
    asymmetricShorthandFrom(declaration)
  );
}

function physicalPropertyFrom(property: string): Finding | undefined {
  const report = (logical: string): Finding => {
    return { messageId: 'physicalProperty', found: property, logical };
  };
  const sided = sidedProperty.exec(property);
  if (sided !== null) {
    const [, box = '', side = '', suffix = ''] = sided;
    return report(`${box}-${sides[side] ?? side}${suffix}`);
  }
  const corner = cornerProperty.exec(property);
  if (corner !== null) {
    return report(`border-${corners[corner[1] ?? ''] ?? ''}-radius`);
  }
  const inset = sides[property];
  if (inset !== undefined) {
    return report(`inset-${inset}`);
  }
  const size = sizeProperty.exec(property);
  if (size !== null) {
    const [, prefix = '', dimension = ''] = size;
    return report(`${prefix}${sizes[dimension] ?? dimension}`);
  }
  return undefined;
}

function physicalValueFrom({ property, value }: CssDeclaration): Finding | undefined {
  const logical = sidedValues[property]?.[value];
  if (logical === undefined) {
    return undefined;
  }
  return {
    messageId: 'physicalValue',
    found: `${property}: ${value}`,
    logical: `${property}: ${logical}`,
  };
}

function asymmetricShorthandFrom({ property, value }: CssDeclaration): Finding | undefined {
  const parts = valuePartsFrom(value);
  const found = `${property}: ${value}`;
  if (boxShorthands.has(property) && parts.length === 4 && parts[1] !== parts[3]) {
    const [block, inline] = shorthandLonghandsFrom(property);
    return {
      messageId: 'asymmetricShorthand',
      found,
      logical: `\`${block}\` and \`${inline}\``,
    };
  }
  if (property === 'border-radius' && !isRadiusMirrored(parts)) {
    return {
      messageId: 'asymmetricShorthand',
      found,
      logical: '`border-start-start-radius` and its siblings',
    };
  }
  return undefined;
}

/** `margin` → `margin-block`/`margin-inline`; `border-width` → `border-block-width`/…. */
function shorthandLonghandsFrom(property: string): readonly [string, string] {
  const border = borderShorthand.exec(property);
  if (border !== null) {
    return [`border-block-${border[1] ?? ''}`, `border-inline-${border[1] ?? ''}`];
  }
  return [`${property}-block`, `${property}-inline`];
}

/** Corners listed top-left, top-right, bottom-right, bottom-left; mirrored if left equals right. */
function isRadiusMirrored(parts: readonly string[]): boolean {
  const slash = parts.indexOf('/');
  if (slash !== -1) {
    return isRadiusMirrored(parts.slice(0, slash)) && isRadiusMirrored(parts.slice(slash + 1));
  }
  if (parts.length <= 1) {
    return true;
  }
  if (parts.length === 2 || parts.length === 3) {
    return parts[0] === parts[1];
  }
  return parts[0] === parts[1] && parts[2] === parts[3];
}

/** A value split on top-level whitespace, so `calc(-1 * var(--x))` stays one part. */
function valuePartsFrom(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }
    if (depth === 0 && whitespace.test(character)) {
      if (current !== '') {
        parts.push(current);
      }
      current = '';
    } else {
      current += character;
    }
  }
  if (current !== '') {
    parts.push(current);
  }
  return parts.filter((part) => {
    return part !== '!important';
  });
}
