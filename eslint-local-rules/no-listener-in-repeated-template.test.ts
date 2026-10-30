import { createRuleTester } from './create-rule-tester.ts';
import { noListenerInRepeatedTemplate } from './no-listener-in-repeated-template.ts';

createRuleTester().run('no-listener-in-repeated-template', noListenerInRepeatedTemplate, {
  valid: [
    'const view = html`<button @click=${onClick}>Go</button>`;',
    'const rows = items.map((item) => html`<li data-action="open" data-id=${item.id}>${item.name}</li>`);',
    'const list = html`<ol @click=${onClick}>${items.map((item) => html`<li>${item}</li>`)}</ol>`;',
    'const rows = items.map((item) => css`a { color: ${item}; }`);',
    'const rows = items.map((item) => html`<a href="mailto:x@y.z?${item}">mail</a>`);',
    'const rows = items.filter((item) => html`<b @click=${f}></b>`);',
    `class A {
      renderRow(item) { return html\`<li data-action="open">\${item}</li>\`; }
      renderHeader() { return html\`<h1 @click=\${this.onClick}></h1>\`; }
      render() { return html\`\${this.renderHeader()}\${this.items.map((item) => this.renderRow(item))}\`; }
    }`,
  ],
  invalid: [
    {
      code: 'const rows = items.map((item) => html`<li @click=${() => open(item)}>${item}</li>`);',
      errors: [{ messageId: 'bindingInRepeat', data: { event: 'click' } }],
    },
    {
      code: 'const rows = items.flatMap((item) => [html`<li @pointerenter="${hover}"></li>`]);',
      errors: [{ messageId: 'bindingInRepeat', data: { event: 'pointerenter' } }],
    },
    {
      code: 'const rows = repeat(items, (item) => item.id, (item) => html`<li @keydown=${onKey}></li>`);',
      errors: [{ messageId: 'bindingInRepeat', data: { event: 'keydown' } }],
    },
    {
      code: 'const rows = map(items, (item) => svg`<g @click=${onClick}></g>`);',
      errors: [{ messageId: 'bindingInRepeat', data: { event: 'click' } }],
    },
    {
      code: 'const rows = items.map((item) => item.open ? html`<b @click=${f}></b>` : nothing);',
      errors: [{ messageId: 'bindingInRepeat', data: { event: 'click' } }],
    },
    {
      code: `class A {
        renderRow(item) { return html\`<li @click=\${() => this.open(item)}>\${item}</li>\`; }
        render() { return html\`<ol>\${this.items.map((item) => this.renderRow(item))}</ol>\`; }
      }`,
      errors: [{ messageId: 'callInRepeat', data: { name: 'this.renderRow' } }],
    },
    {
      code: `class A {
        renderButton() { return html\`<button @click=\${this.onClick}></button>\`; }
        renderRow(item) { return html\`<li>\${item}\${this.renderButton()}</li>\`; }
        render() { return html\`<ol>\${repeat(this.items, (item) => item, (item) => this.renderRow(item))}</ol>\`; }
      }`,
      errors: [{ messageId: 'callInRepeat', data: { name: 'this.renderRow' } }],
    },
    {
      code: `class A {
        readonly renderRow = (item) => html\`<li @dblclick=\${this.onOpen}>\${item}</li>\`;
        render() { return html\`<ol>\${this.items.map(this.renderRow)}</ol>\`; }
      }`,
      errors: [{ messageId: 'callInRepeat', data: { name: 'this.renderRow' } }],
    },
    {
      code: `function renderChip(chip) { return html\`<span @click=\${chip.run}></span>\`; }
        const chips = items.map((item) => renderChip(item));`,
      errors: [{ messageId: 'callInRepeat', data: { name: 'renderChip' } }],
    },
  ],
});
