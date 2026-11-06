import { createRuleTester } from './create-rule-tester.ts';
import { cssLogicalProperties } from './css-logical-properties.ts';

createRuleTester().run('css-logical-properties', cssLogicalProperties, {
  valid: [
    'const s = css`:host { margin-inline-start: 4px; padding-block: 2px 4px; inline-size: 100%; }`;',
    'const s = css`.a { inset-block-start: 0; inset-inline-end: ${gap}; text-align: start; }`;',
    'const s = css`.a { margin: 0 0 8px; padding: 4px 8px; inset: 0 0 auto; }`;',
    'const s = css`.a { padding: 2px 8px 2px 8px; border-radius: 0 0 6px 6px; }`;',
    'const s = css`.a { overflow-x: auto; resize: block; float: inline-start; }`;',
    'const s = css`.row > label:first-child { color: red; }`;',
    'const s = `margin-left: 4px; width: 10px`;',
    'const s = html`<div style="width: 10px"></div>`;',
  ],
  invalid: [
    {
      code: 'const s = css`.a { margin-left: 4px; }`;',
      errors: [
        {
          messageId: 'physicalProperty',
          data: { found: 'margin-left', logical: 'margin-inline-start' },
        },
      ],
    },
    {
      code: 'const s = css`.a { border-bottom-color: red; }`;',
      errors: [
        {
          messageId: 'physicalProperty',
          data: { found: 'border-bottom-color', logical: 'border-block-end-color' },
        },
      ],
    },
    {
      code: 'const s = css`.a { top: 0; }`;',
      errors: [
        { messageId: 'physicalProperty', data: { found: 'top', logical: 'inset-block-start' } },
      ],
    },
    {
      code: 'const s = css`.a { max-width: ${w}px; }`;',
      errors: [
        { messageId: 'physicalProperty', data: { found: 'max-width', logical: 'max-inline-size' } },
      ],
    },
    {
      code: 'const s = css`.a { border-top-left-radius: 4px; }`;',
      errors: [
        {
          messageId: 'physicalProperty',
          data: { found: 'border-top-left-radius', logical: 'border-start-start-radius' },
        },
      ],
    },
    {
      code: 'const s = css`.a { text-align: right; }`;',
      errors: [
        {
          messageId: 'physicalValue',
          data: { found: 'text-align: right', logical: 'text-align: end' },
        },
      ],
    },
    {
      code: 'const s = css`.a { padding: 0 0 0 calc(2 * var(--x)); }`;',
      errors: [{ messageId: 'asymmetricShorthand' }],
    },
    {
      code: 'const s = css`.a { inset: 0 auto 0 0; }`;',
      errors: [{ messageId: 'asymmetricShorthand' }],
    },
    {
      code: 'const s = css`.a { border-radius: 6px 0 0 6px; }`;',
      errors: [{ messageId: 'asymmetricShorthand' }],
    },
    {
      code: 'const s = css`.a { width: 1px; height: 1px; }`;',
      errors: [{ messageId: 'physicalProperty' }, { messageId: 'physicalProperty' }],
    },
  ],
});
