/** What an HTML string would build, as far as markup goes: which elements and attributes, and the text. */
export interface HtmlStructure {
  /**
   * Sorted and unique: `tag` for each start tag, `tag[attribute]` for each attribute on it, and
   * `<!…>`, `<?…>` or `</…>` for each comment, declaration, processing instruction or malformed end tag.
   */
  readonly markup: readonly string[];
  /** The character data, references decoded, outside raw-text elements. */
  readonly text: string;
}

/** Elements whose content the HTML tokenizer reads as text up to their end tag. */
const rawTextElements: ReadonlySet<string> = new Set([
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);
const namedReferences: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u{A0}',
  quot: '"',
};
const reference = /&(?:#x([\da-f]+)|#(\d+)|([a-z]+));?/giu;
const asciiLetter = /[a-z]/iu;
const space = /[\t\n\f\r ]/u;

/**
 * Tokenizes `html` the way a browser's HTML tokenizer starts a tag, an attribute or a comment
 * (WHATWG HTML 13.2.5), so an escaping bug in the producer shows up as markup the benign twin of
 * the input did not produce. It is a test oracle for library output, not a sanitizer: it ignores
 * tree construction, which never adds attributes and adds elements only around markup it was given.
 */
export function htmlStructureFrom(html: string): HtmlStructure {
  const markup = new Set<string>();
  let text = '';
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    text += decodedFrom(html.slice(index, open === -1 ? html.length : open));
    if (open === -1) {
      break;
    }
    const tag = tagAt(html, open);
    if (tag === undefined) {
      text += '<';
      index = open + 1;
      continue;
    }
    for (const entry of tag.markup) {
      markup.add(entry);
    }
    index = tag.end;
    if (tag.rawText === undefined) {
      continue;
    }
    const close = html.toLowerCase().indexOf(`</${tag.rawText}`, index);
    index = close === -1 ? html.length : close;
  }
  return { markup: [...markup].toSorted((a, b) => a.localeCompare(b, 'en')), text };
}

/** Character data with its numeric and common named references decoded. */
function decodedFrom(data: string): string {
  let decoded = '';
  let last = 0;
  for (const match of data.matchAll(reference)) {
    const [whole, hex, decimal, named] = match;
    decoded += data.slice(last, match.index) + referenceValue(whole, hex, decimal, named);
    last = match.index + whole.length;
  }
  return decoded + data.slice(last);
}

function referenceValue(
  whole: string,
  hex: string | undefined,
  decimal: string | undefined,
  named: string | undefined,
): string {
  if (hex !== undefined) {
    return String.fromCodePoint(Number.parseInt(hex, 16));
  }
  if (decimal !== undefined) {
    return String.fromCodePoint(Number(decimal));
  }
  return named === undefined ? whole : (namedReferences[named.toLowerCase()] ?? whole);
}

interface Tag {
  readonly markup: readonly string[];
  /** Just past the tag. */
  readonly end: number;
  /** The element's name when its content is raw text. */
  readonly rawText?: string;
}

/** The tag, comment or declaration at `open` (a `<`), or `undefined` when the `<` is text. */
function tagAt(html: string, open: number): Tag | undefined {
  const next = html[open + 1] ?? '';
  if (html.startsWith('<!--', open)) {
    const close = html.indexOf('-->', open + 4);
    return { markup: ['<!…>'], end: close === -1 ? html.length : close + 3 };
  }
  if (next === '!' || next === '?') {
    return { markup: [`<${next}…>`], end: pastGreaterThan(html, open) };
  }
  if (next === '/') {
    // An end tag adds nothing; `</` followed by anything but a letter is a bogus comment.
    const isEndTag = asciiLetter.test(html[open + 2] ?? '');
    return { markup: isEndTag ? [] : ['</…>'], end: pastGreaterThan(html, open) };
  }
  return asciiLetter.test(next) ? startTagAt(html, open) : undefined;
}

function pastGreaterThan(html: string, from: number): number {
  const close = html.indexOf('>', from);
  return close === -1 ? html.length : close + 1;
}

/** A start tag: its name, then attributes as the tokenizer's attribute states read them. */
function startTagAt(html: string, open: number): Tag {
  let index = open + 1;
  const readWhile = (isPart: (character: string) => boolean): string => {
    const from = index;
    while (index < html.length && isPart(html[index] ?? '')) {
      index += 1;
    }
    return html.slice(from, index);
  };
  const tagName = readWhile(
    (character) => !isSpace(character) && !'/>'.includes(character),
  ).toLowerCase();
  const markup = [tagName];
  for (;;) {
    readWhile((character) => isSpace(character) || character === '/');
    if (index >= html.length || html[index] === '>') {
      break;
    }
    // The first character of a name may be `=`; after it, `=` ends the name.
    const first = html[index] ?? '';
    index += 1;
    const rest = readWhile((character) => !isSpace(character) && !'/>='.includes(character));
    markup.push(`${tagName}[${(first + rest).toLowerCase()}]`);
    readWhile(isSpace);
    if (html[index] !== '=') {
      continue;
    }
    index += 1;
    readWhile(isSpace);
    const quote = html[index] ?? '';
    if (quote === '"' || quote === "'") {
      index += 1;
      readWhile((character) => character !== quote);
      index += 1;
    } else {
      readWhile((character) => !isSpace(character) && character !== '>');
    }
  }
  return {
    markup,
    end: Math.min(index + 1, html.length),
    ...(rawTextElements.has(tagName) && { rawText: tagName }),
  };
}

function isSpace(character: string): boolean {
  return space.test(character);
}
