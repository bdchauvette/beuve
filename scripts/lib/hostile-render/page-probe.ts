/**
 * Page-side helpers for `check-hostile-render.ts`, evaluated in a renderer through DevTools (so
 * neither the CSP nor Trusted Types applies to the evaluation itself). Defines
 * `globalThis.__hostileProbe`:
 *
 * - `all(selector, start?)`: every match in `start` and in every shadow root under it.
 * - `text(start?)`: the text of `start` and every shadow root under it, outside `style` and `script`.
 * - `unsafe()`: descriptions of every element or attribute in the page (shadow roots included) that
 *   would run script or load from elsewhere: `script` outside `<head>`, frames, plugins, `<base>`,
 *   any `on*` attribute, a `javascript:` or `vbscript:` URL in an attribute that takes a URL (an
 *   inert `data-*` or `title` may hold the text), and an SVG `<use>` that is not a
 *   same-document `#id` reference.
 * - `rows(start?)`: the number of rendered diff or code rows.
 * - `sanitize(html)`: `html` assigned to a `<template>`'s `innerHTML` (so through the page's
 *   Trusted Types default policy) and serialized back.
 * - `mount(html)`: `html` assigned to a new `<div>`'s `innerHTML` (through the default policy too)
 *   and appended to the body, live.
 * - `html(element, skip?)`: `element`'s shadow root (or the element) serialized with every shadow
 *   root under it, for the structural oracle (`src/ui/testing/extra-markup.ts`), leaving out what
 *   matches `skip` (swapped for a comment while it serializes, then put back).
 */
export const pageProbe = String.raw`(() => {
  const xlink = 'http://www.w3.org/1999/xlink';
  // Attributes a URL navigates, loads or submits from, and SVG animation values that can set one.
  const urlAttributes = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'data', 'poster', 'background', 'ping', 'cite', 'codebase', 'manifest', 'to', 'from', 'values', 'by']);
  // As the URL parser reads a scheme: tabs and newlines removed, leading C0 controls and spaces trimmed.
  const isScriptUrl = (value) => /^(?:javascript|vbscript):/iu.test(value.replaceAll(/[\t\n\r]/gu, '').replace(/^[\u0000-\u0020]+/u, ''));
  const roots = (start) => {
    const found = [start];
    for (const element of start.querySelectorAll('*')) {
      if (element.shadowRoot) found.push(...roots(element.shadowRoot));
    }
    return found;
  };
  const all = (selector, start = document) => roots(start).flatMap((root) => [...root.querySelectorAll(selector)]);
  const text = (start = document) => {
    let collected = '';
    for (const root of roots(start)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement?.localName;
        if (parent !== 'style' && parent !== 'script') collected += node.data;
      }
      collected += '\n';
    }
    return collected;
  };
  const describe = (element, why) => why + ': <' + element.localName + ' ' + [...element.attributes].map((a) => a.name + '="' + a.value.slice(0, 80) + '"').join(' ') + '>';
  const unsafe = () => {
    const found = [];
    for (const element of all('*')) {
      const name = element.localName;
      if (name === 'script' && !element.closest('head')) found.push(describe(element, 'script outside head'));
      if (['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'portal', 'fencedframe'].includes(name)) found.push(describe(element, 'embedding element'));
      for (const attribute of element.attributes) {
        if (/^on/iu.test(attribute.name)) found.push(describe(element, 'event handler attribute'));
        if (urlAttributes.has(attribute.localName) && isScriptUrl(attribute.value)) found.push(describe(element, 'script URL'));
      }
      if (name === 'use' && (!(element.getAttribute('href') ?? '').startsWith('#') || element.hasAttributeNS(xlink, 'href') || element.hasAttribute('xlink:href'))) {
        found.push(describe(element, 'use outside the document'));
      }
    }
    return found;
  };
  const rows = (start = document) => all('[data-line]', start).length;
  const sanitize = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.innerHTML;
  };
  const mount = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    return true;
  };
  const html = (element, skip) => {
    const root = element.shadowRoot ?? element;
    const skipped = skip ? all(skip, root).map((node) => [node, document.createComment('')]) : [];
    for (const [node, mark] of skipped) node.replaceWith(mark);
    try {
      return root.getHTML({ shadowRoots: roots(root).slice(1) });
    } finally {
      for (const [node, mark] of skipped) mark.replaceWith(node);
    }
  };
  globalThis.__hostileProbe = { all, text, unsafe, rows, sanitize, mount, html };
  return true;
})()`;
