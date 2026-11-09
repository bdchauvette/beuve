/** Data attributes beuve's own Markdown rules write (ADR 0123); nothing else `data-*` survives. */
const ownAttributes = ['data-source-lines', 'data-html-lines', 'data-task', 'data-alert'];

/** Attributes any kept element may have. `id` and `name` become `data-anchor` afterwards. */
const globalAttributes = ['title', 'align', 'lang', 'dir', 'id', ...ownAttributes];

/** Elements whose markup goes and whose content stays, from READMEs written for GitHub. */
const unwrapped = ['center', 'font', 'big', 'nobr', 'tt', 'strike', 'blink', 'marquee'];

const plain = [
  'html',
  'head',
  'body',
  'abbr',
  'b',
  'bdi',
  'blockquote',
  'br',
  'caption',
  'cite',
  'dd',
  'del',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'ins',
  'kbd',
  'mark',
  'p',
  'picture',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
];

/**
 * The allow-list repository Markdown is parsed with (ADR 0123): GFM's output and the inline and
 * block HTML READMEs use, no `style`, no classes except a code block's language, no `data-*`
 * but beuve's own, no comments. The Sanitizer API's safe parse removes scripts, handlers and
 * `javascript:` URLs on top of this; links and images are rewritten after it.
 */
export const markdownSanitizerConfig: SanitizerConfig = {
  elements: [
    ...plain,
    { name: 'a', attributes: ['href', 'name'] },
    { name: 'code', attributes: ['class'] },
    { name: 'details', attributes: ['open'] },
    { name: 'img', attributes: ['src', 'alt', 'width', 'height'] },
    { name: 'li', attributes: ['value'] },
    { name: 'ol', attributes: ['start', 'type', 'reversed'] },
    { name: 'td', attributes: ['colspan', 'rowspan'] },
    { name: 'th', attributes: ['colspan', 'rowspan', 'scope'] },
  ],
  attributes: globalAttributes,
  replaceWithChildrenElements: unwrapped,
  comments: false,
  dataAttributes: false,
};
