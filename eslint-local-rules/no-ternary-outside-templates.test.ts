import { createRuleTester } from './create-rule-tester.ts';
import { noTernaryOutsideTemplates } from './no-ternary-outside-templates.ts';

createRuleTester().run('no-ternary-outside-templates', noTernaryOutsideTemplates, {
  valid: [
    'const a = 1;',
    'const t = html`<p>${x ? "a" : "b"}</p>`;',
    'const t = svg`<circle r=${big ? 2 : 1}></circle>`;',
    'const t = html`<p class=${on ? "a" : "b"}></p>`;',
    'const t = html`<input .value=${x ? y : z} ?disabled=${off ? true : false} />`;',
    'const t = html`<p>${(x ? "a" : "b")}</p>`;',
    'const t = html`<p>${a && (b ? "x" : "y")}</p>`;',
    'const t = html`<p>${html`<b>${x ? 1 : 2}</b>`}</p>`;',
    'import { html } from "lit"; const t = html`<p>${x ? 1 : 2}</p>`;',
    'import { html } from "lit-html"; const t = html`<p>${x ? 1 : 2}</p>`;',
    'import { html } from "lit/static-html.js"; const t = html`<p>${x ? 1 : 2}</p>`;',
    'const t = html`<p>${x ? a : y ? b : c}</p>`;',
    'type T<A> = A extends string ? 1 : 2;',
    'type T<A> = A extends string ? (A extends "a" ? 1 : 2) : 3;',
  ],
  invalid: [
    { code: 'const a = x ? 1 : 2;', errors: [{ messageId: 'noTernary' }] },
    {
      code: 'function f(x: boolean): number { return x ? 1 : 2; }',
      errors: [{ messageId: 'noTernary' }],
    },
    { code: 'const s = `${x ? "a" : "b"}`;', errors: [{ messageId: 'noTernary' }] },
    { code: 'const s = tag`${x ? "a" : "b"}`;', errors: [{ messageId: 'noTernary' }] },
    { code: 'const s = css`${x ? "a" : "b"}`;', errors: [{ messageId: 'noTernary' }] },
    { code: 'const s = foo.html`${x ? "a" : "b"}`;', errors: [{ messageId: 'noTernary' }] },
    {
      code: 'import { html } from "./other.ts"; const t = html`<p>${x ? 1 : 2}</p>`;',
      errors: [{ messageId: 'noTernary' }],
    },
    {
      code: 'const t = html`<ul>${items.map((i) => (i.on ? html`<li></li>` : nothing))}</ul>`;',
      errors: [{ messageId: 'noTernary' }],
    },
    {
      code: 'const t = html`<p>${items.map(function (i) { return i ? 1 : 2; })}</p>`;',
      errors: [{ messageId: 'noTernary' }],
    },
    {
      code: 'const t = html`<p>${x ? "a" : "b"}</p>`; const y = x ? 1 : 2;',
      errors: [{ messageId: 'noTernary', column: 52 }],
    },
    {
      code: 'const f = x ? html`<p></p>` : null;',
      errors: [{ messageId: 'noTernary' }],
    },
    {
      code: 'class A { x = html`${(): number => (y ? 1 : 2)}`; }',
      errors: [{ messageId: 'noTernary' }],
    },
  ],
});
