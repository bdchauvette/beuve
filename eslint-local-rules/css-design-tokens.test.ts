import { createRuleTester } from './create-rule-tester.ts';
import { cssDesignTokens } from './css-design-tokens.ts';

createRuleTester().run('css-design-tokens', cssDesignTokens, {
  valid: [
    'const s = css`.a { color: var(--beuve-text); background: transparent; border-color: currentColor; }`;',
    'const s = css`.a { font: var(--beuve-font-small); font-size: var(--beuve-font-size-mark); }`;',
    'const s = css`.a { font-size: var(--beuve-font-size-caption); --diffs-font-size: var(--beuve-font-size-code); }`;',
    'const s = css`.a { padding: var(--beuve-space-1); inline-size: 100%; flex: 1 0 0; }`;',
    'const s = css`.a { grid-template-columns: calc(13 * var(--beuve-measure-em)) 1fr; line-height: 1.5; }`;',
    'const s = html`<div style="inline-size: ${width}px"></div>`;',
    'const width = `${String(size)}px`;',
    "const label = 'Updated 5 minutes ago';",
    'const s = css`.a { font: inherit; }`;',
    'const s = `color: #fff`;',
    "import './beuve-menu.ts';",
  ],
  invalid: [
    {
      code: 'const s = css`.a { color: #fff; }`;',
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      code: 'const s = css`.a { box-shadow: 0 4px 16px rgb(0 0 0 / 25%); }`;',
      errors: [{ messageId: 'colorLiteral' }],
    },
    {
      code: 'const s = css`.a { font-size: 11px; }`;',
      errors: [{ messageId: 'fontSizeLiteral' }],
    },
    {
      code: 'const s = css`.a { font: 600 0.75rem/1.2 system-ui; }`;',
      errors: [{ messageId: 'fontSizeLiteral' }],
    },
    {
      code: 'const s = css`.a { --trees-font-size-override: 12px; }`;',
      errors: [{ messageId: 'fontSizeLiteral' }],
    },
    {
      code: 'const s = css`.a { font-size: 0.85em; }`;',
      errors: [{ messageId: 'lengthLiteral' }],
    },
    {
      code: 'const s = css`.a { padding: 2px var(--beuve-space-2); }`;',
      errors: [{ messageId: 'lengthLiteral' }],
    },
    {
      code: 'const s = css`.a { max-block-size: 60vh; inline-size: 14em; }`;',
      errors: [{ messageId: 'lengthLiteral' }, { messageId: 'lengthLiteral' }],
    },
    {
      code: 'const s = css`.a { --local-width: 1100px; }`;',
      errors: [{ messageId: 'lengthLiteral' }],
    },
    {
      code: 'const s = html`<div style="margin: 2rem"></div>`;',
      errors: [{ messageId: 'lengthInString', data: { length: '2rem' } }],
    },
    {
      code: "notice.style.setProperty('margin', '2rem');",
      errors: [{ messageId: 'lengthInString' }],
    },
    {
      code: 'const rule = `${selector}{inset-block-start:-3px}`;',
      errors: [{ messageId: 'lengthInString', data: { length: '-3px' } }],
    },
    {
      code: 'const s = css`.a { color: var(--beuve-scale-gray-11); }`;',
      errors: [{ messageId: 'scaleToken' }],
    },
  ],
});
