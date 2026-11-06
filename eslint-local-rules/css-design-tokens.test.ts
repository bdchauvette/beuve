import { createRuleTester } from './create-rule-tester.ts';
import { cssDesignTokens } from './css-design-tokens.ts';

createRuleTester().run('css-design-tokens', cssDesignTokens, {
  valid: [
    'const s = css`.a { color: var(--beuve-text); background: transparent; border-color: currentColor; }`;',
    'const s = css`.a { font: var(--beuve-font-small); font-size: 0.85em; }`;',
    'const s = css`.a { font-size: var(--beuve-font-size-caption); --diffs-font-size: var(--beuve-font-size-code); }`;',
    'const s = css`.a { padding: 2px; inline-size: 16px; }`;',
    'const s = css`.a { font: inherit; }`;',
    'const s = `color: #fff`;',
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
      code: 'const s = css`.a { color: var(--beuve-scale-gray-11); }`;',
      errors: [{ messageId: 'scaleToken' }],
    },
  ],
});
