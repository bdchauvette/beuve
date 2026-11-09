import type MarkdownIt from 'markdown-it';

import { headingSlugsFrom } from '../heading-slugs-from.ts';
import { imageSourceFrom } from '../image-source-from.ts';
import { linkTargetFrom } from '../link-target-from.ts';

import { createMarkdownIt } from './create-markdown-it.ts';
import type { MarkdownEnv } from './create-markdown-it.ts';
import { markdownSanitizerConfig } from './markdown-sanitizer-config.ts';

/** A Markdown file's text and its repository-relative path, which relative links start from. */
export interface MarkdownSource {
  readonly text: string;
  readonly file: string;
}

/** An image that is not shown, why, and what the file wrote as its source. */
interface MissingImage {
  readonly image: HTMLImageElement;
  readonly why: string;
  readonly source: string;
}

const shared: { md: MarkdownIt | undefined } = { md: undefined };
const languageClass = /(?:^|\s)language-(\S+)/u;
const userContent = 'user-content-';

/**
 * A Markdown file rendered as nodes of `document` (ADR 0123), built from markdown-it's HTML by
 * the Sanitizer API's safe parse with the allow-list, then rewritten before any of it is live:
 *
 * - Regions carry `data-source-lines="a-b"`; a raw HTML block takes its marker's lines, and a
 *   value the document wrote itself (without this render's nonce) is dropped.
 * - Ids and `<a name>` become `data-anchor` (GitHub's `user-content-` prefix dropped), headings
 *   take GitHub's slugs, so nothing in the file sets an id.
 * - Links lose `href` and carry `data-action="link"` with what `linkTargetFrom` made of it.
 * - Images lose `src`: a repository image carries `data-image-path` for the view to load, an
 *   inline `data:` image keeps it, and a remote one becomes a placeholder naming its host.
 * - A code block carries `data-code-language` (and `data-mermaid` for a diagram), its lines on
 *   the `<pre>`.
 */
export function markdownDocumentFrom({ text, file }: MarkdownSource): DocumentFragment {
  shared.md ??= createMarkdownIt();
  const nonce = crypto.randomUUID();
  const env: MarkdownEnv = { sourceNonce: nonce };
  const html = shared.md.render(text, env);
  const parsers = Document as unknown as DocumentParsers;
  const { body } = parsers.parseHTML(html, { sanitizer: markdownSanitizerConfig });
  keepOwnLines(body, nonce);
  placeHtmlLines(body);
  anchorsIn(body);
  for (const link of body.querySelectorAll<HTMLElement>('a[href]')) {
    rewriteLink(link, file);
  }
  for (const image of body.querySelectorAll('img')) {
    rewriteImage(image, file);
  }
  for (const pre of body.querySelectorAll('pre')) {
    markCodeBlock(pre);
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...document.adoptNode(body).childNodes);
  return fragment;
}

/** Keeps the line values this render wrote, without their nonce, and drops any other. */
function keepOwnLines(body: HTMLElement, nonce: string): void {
  const prefix = `${nonce}:`;
  for (const element of body.querySelectorAll<HTMLElement>('[data-source-lines]')) {
    element.dataset['sourceLines'] = ownValue(element.dataset['sourceLines'], prefix);
  }
  for (const element of body.querySelectorAll<HTMLElement>('[data-html-lines]')) {
    element.dataset['htmlLines'] = ownValue(element.dataset['htmlLines'], prefix);
  }
  for (const element of body.querySelectorAll<HTMLElement>(
    '[data-source-lines=""], [data-html-lines=""]',
  )) {
    delete element.dataset['sourceLines'];
    delete element.dataset['htmlLines'];
  }
}

function ownValue(value: string | undefined, prefix: string): string {
  if (value?.startsWith(prefix) !== true) {
    return '';
  }
  return value.slice(prefix.length);
}

/**
 * Gives each raw HTML block's first element its marker's lines, and widens an element a later
 * block closes (`<details>` … `</details>`) to that block's last line.
 */
function placeHtmlLines(body: HTMLElement): void {
  for (const marker of body.querySelectorAll<HTMLElement>('span[data-html-lines]')) {
    const lines = marker.dataset['htmlLines'] ?? '';
    const next = marker.nextElementSibling;
    const parent = marker.parentElement;
    marker.remove();
    if (next instanceof HTMLElement) {
      if (next.dataset['sourceLines'] === undefined && next.dataset['htmlLines'] === undefined) {
        next.dataset['sourceLines'] = lines;
      }
      continue;
    }
    const opened = parent?.dataset['sourceLines'];
    if (parent === null || parent === body || opened === undefined) {
      continue;
    }
    const [start = ''] = opened.split('-', 1);
    const [, end = ''] = lines.split('-', 2);
    parent.dataset['sourceLines'] = `${start}-${end}`;
  }
}

function anchorsIn(body: HTMLElement): void {
  for (const element of body.querySelectorAll<HTMLElement>('[id], a[name]')) {
    const value = element.getAttribute('id') ?? element.getAttribute('name') ?? '';
    element.removeAttribute('id');
    element.removeAttribute('name');
    let anchor = value;
    if (anchor.startsWith(userContent)) {
      anchor = anchor.slice(userContent.length);
    }
    if (anchor !== '') {
      element.dataset['anchor'] = anchor;
    }
  }
  const headings = [...body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  const slugs = headingSlugsFrom(headings.map((heading) => heading.textContent));
  for (const [index, heading] of headings.entries()) {
    heading.dataset['anchor'] = slugs[index] ?? '';
  }
}

function rewriteLink(link: HTMLElement, file: string): void {
  const href = link.getAttribute('href') ?? '';
  link.removeAttribute('href');
  const target = linkTargetFrom({ file, reference: href });
  if (target.kind === 'none') {
    return;
  }
  link.dataset['action'] = 'link';
  link.dataset['linkKind'] = target.kind;
  link.setAttribute('role', 'link');
  link.tabIndex = 0;
  if (target.kind === 'external') {
    link.dataset['linkHref'] = target.href;
    link.title = target.href;
  } else if (target.kind === 'fragment') {
    link.dataset['linkAnchor'] = target.id;
  } else {
    link.dataset['linkPath'] = target.path;
    link.title = target.path;
    if (target.line !== undefined) {
      link.dataset['linkLine'] = String(target.line);
    }
  }
}

function rewriteImage(image: HTMLImageElement, file: string): void {
  const source = image.getAttribute('src') ?? '';
  image.removeAttribute('src');
  const found = imageSourceFrom({ file, reference: source });
  switch (found.kind) {
    case 'inline': {
      image.src = found.uri;
      return;
    }
    case 'file': {
      image.dataset['imagePath'] = found.path;
      return;
    }
    case 'remote': {
      image.replaceWith(placeholder({ image, why: `not loaded from ${found.host}`, source }));
      return;
    }
    case 'none': {
      image.replaceWith(placeholder({ image, why: 'no image', source }));
    }
  }
}

/** A remote or unreadable image as its alt text and why it isn't shown; the source as tooltip. */
function placeholder({ image, why, source }: MissingImage): HTMLElement {
  const element = document.createElement('span');
  element.className = 'image-placeholder';
  element.title = source;
  let label = why;
  if (image.alt !== '') {
    label = `${image.alt} (${why})`;
  }
  element.textContent = label;
  return element;
}

function markCodeBlock(pre: HTMLElement): void {
  const code = pre.querySelector<HTMLElement>(':scope > code');
  if (code === null) {
    return;
  }
  const lines = code.dataset['sourceLines'];
  if (lines !== undefined) {
    pre.dataset['sourceLines'] = lines;
    delete code.dataset['sourceLines'];
  }
  const language = languageClass.exec(code.className)?.[1];
  code.removeAttribute('class');
  if (language === undefined) {
    return;
  }
  pre.dataset['codeLanguage'] = language;
  if (language === 'mermaid') {
    pre.dataset['mermaid'] = '';
  }
}
