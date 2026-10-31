import { errorFrom } from '#x/error/error-from.ts';

/** The only script URL the renderer creates: the `@pierre/diffs` highlighting worker (ADR 0050). */
const highlighterWorker = 'diff-worker/worker.js';
const svgNamespace = 'http://www.w3.org/2000/svg';
/**
 * Removed besides the Sanitizer's unsafe set: every element that navigates or submits, and the
 * attributes that make a `<button>` (the gutter's utility button) submit, so no `javascript:` URL
 * survives; and SVG animation, which can rewrite an `href`. The libraries' HTML uses none of them.
 */
const navigatingAttributes: readonly string[] = ['formaction', 'action', 'form'];
const navigatingElements: readonly SanitizerElement[] = [
  'a',
  'area',
  'base',
  'form',
  'input',
  'select',
  'textarea',
  'meta',
  'link',
  ...['a', 'animate', 'animateMotion', 'animateTransform', 'set'].map((name) => {
    return {
      name,
      namespace: svgNamespace,
    };
  }),
];
/**
 * Parsed once at install: if the script or the link survives, the parse ignored the sanitizer. No
 * event handler: parsing one reports a `script-src-attr` violation even in an inert document.
 */
const selfTestHtml = '<b>b</b><script>0</script><a href="#">a</a>';

/**
 * Installs the renderer's Trusted Types `default` policy (ADR 0077). Lit has its own `lit-html`
 * policy, and beuve's code has no HTML sinks (lint bans them), so this policy only sees what the
 * libraries assign: `@pierre/diffs` and `@pierre/trees` set `innerHTML` from strings they render.
 * Each entry calls it before anything renders.
 *
 * Each string is parsed with the Sanitizer API and serialized back. The safe parse
 * (`Document.parseHTML`) would also remove SVG `<use>`, which every icon in a diff is, so the
 * policy parses with `parseHTMLUnsafe` and a configuration that removes the unsafe set
 * (`removeUnsafe()`: scripts, frames, event handler attributes), every navigating element and SVG
 * animation, then keeps a `<use>` only when it points into the document (`#id`). The unsafe parse
 * is itself a Trusted Types sink, so it receives the input through a pass-through policy,
 * `beuve-sanitizer-input`, that only the parser's closure holds; the CSP's `trusted-types` list
 * has no `'allow-duplicates'`, so nothing can create either name again. The one script URL
 * allowed is the highlighting worker's; any other throws.
 *
 * It fails closed: without Trusted Types or a Sanitizer API that honours a configuration, it
 * claims `default` with a policy that throws, replaces the page with the error, and throws.
 */
export function installTrustedTypesPolicy(): void {
  // eslint-disable-next-line unicorn/no-unnecessary-global-this -- a bare read throws where Trusted Types is missing.
  const factory = globalThis.trustedTypes;
  const parsers = Document as unknown as Partial<DocumentParsers>;
  if (factory === undefined || !('Sanitizer' in globalThis) || !('parseHTMLUnsafe' in parsers)) {
    failClosed(factory, 'this renderer lacks Trusted Types or the HTML Sanitizer API');
  }
  const parse = sanitizingParser(factory, parsers as DocumentParsers);
  const worker = new URL(highlighterWorker, document.baseURI).href;
  factory.createPolicy('default', {
    createHTML: (html: string): string => {
      return withoutForeignUses(parse(html)).body.getHTML();
    },
    createScriptURL: (url: string): string => {
      if (URL.parse(url, document.baseURI)?.href !== worker) {
        throw new TypeError(`beuve loads no script from ${url}`);
      }
      return url;
    },
  });
}

/**
 * Claims `default` with a policy that admits nothing, so no library string becomes markup, shows
 * `reason` in place of the page, and throws.
 */
function failClosed(factory: TrustedTypePolicyFactory | undefined, reason: string): never {
  const message = `beuve cannot render safely: ${reason} (ADR 0077).`;
  const refuse = (): never => {
    throw new TypeError(message);
  };
  try {
    factory?.createPolicy('default', { createHTML: refuse, createScriptURL: refuse });
  } catch {
    // Already claimed: whoever holds it, the page below is replaced and nothing renders.
  }
  const notice = document.createElement('p');
  notice.setAttribute('role', 'alert');
  notice.style.setProperty('margin', '2rem');
  notice.textContent = message;
  document.body.replaceChildren(notice);
  throw new TypeError(message);
}

/**
 * Parses through `beuve-sanitizer-input`, which only the returned closure holds, with the library
 * sanitizer, after a self-test parse shows the sanitizer is honoured. Fails closed if any of it
 * throws or the self-test fails.
 */
function sanitizingParser(
  factory: TrustedTypePolicyFactory,
  parser: DocumentParsers,
): (html: string) => Document {
  try {
    const input = factory.createPolicy('beuve-sanitizer-input', {
      createHTML: (html: string): string => {
        return html;
      },
    });
    const sanitizer = librarySanitizer();
    const parse = (html: string): Document => {
      // eslint-disable-next-line no-restricted-syntax -- the sanctioned parse: a sanitizer, a pass-through input policy, then `withoutForeignUses`.
      return parser.parseHTMLUnsafe(input.createHTML(html), { sanitizer });
    };
    if (!isSanitized(parse(selfTestHtml))) {
      throw new TypeError('its parseHTMLUnsafe ignores the sanitizer');
    }
    return parse;
  } catch (error) {
    return failClosed(factory, `the HTML Sanitizer API failed: ${errorFrom(error).message}`);
  }
}

/** The Sanitizer's unsafe set plus navigation and SVG animation, keeping SVG `<use>`. */
function librarySanitizer(): Sanitizer {
  const sanitizer = new Sanitizer({ removeElements: [], removeAttributes: [] });
  sanitizer.removeUnsafe();
  // `removeUnsafe()` removes SVG `<use>`; `withoutForeignUses` keeps only same-document references.
  sanitizer.allowElement({ name: 'use', namespace: svgNamespace });
  for (const element of navigatingElements) {
    sanitizer.removeElement(element);
  }
  for (const attribute of navigatingAttributes) {
    sanitizer.removeAttribute(attribute);
  }
  return sanitizer;
}

/** Whether the self-test's script and link were removed and the rest kept. */
function isSanitized(parsed: Document): boolean {
  return parsed.querySelector('b') !== null && parsed.querySelector('script, a') === null;
}

/** Removes every `<use>` that is not a same-document `#id` reference. */
function withoutForeignUses(parsed: Document): Document {
  for (const use of parsed.querySelectorAll('use')) {
    if (!(use.getAttribute('href') ?? '').startsWith('#') || use.hasAttribute('xlink:href')) {
      use.remove();
    }
  }
  return parsed;
}
