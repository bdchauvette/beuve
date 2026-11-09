import MarkdownIt from 'markdown-it';
import type { StateBlock, StateCore, Token } from 'markdown-it';
import { full as emoji } from 'markdown-it-emoji';
import footnote from 'markdown-it-footnote';

/** What `render(text, env)` may be given: a nonce that marks the source lines beuve wrote. */
export interface MarkdownEnv {
  readonly sourceNonce?: string;
}

/** The block tokens that become regions: they carry their source lines (ADR 0123). */
const regionTokens = new Set([
  'paragraph_open',
  'heading_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'blockquote_open',
  'table_open',
  'tr_open',
  'fence',
  'code_block',
  'hr',
]);

const taskMarker = /^\[([ Xx])\](?:[\t ]+|$)/u;
const alertMarker = /^\[!(note|tip|important|warning|caution)\][\t ]*(?:\n|$)/iu;
const textAlign = /^text-align:(left|center|right)$/u;
const frontMatterEnd = new Set(['---', '...']);
const taskStates: Readonly<Record<string, string>> = { ' ': 'open', x: 'done', X: 'done' };

/**
 * The parser for repository Markdown files (ADR 0123): CommonMark with GFM tables,
 * strikethrough and autolinks, raw HTML (sanitized later, never trusted), footnotes, GitHub's
 * emoji shortcodes without emoticons, task lists, GitHub alerts and YAML front matter shown as
 * code. Every block that can take a note carries `data-source-lines="a-b"` (1-based, inclusive,
 * trailing blank lines left out), and every raw HTML block is preceded by a
 * `<span data-html-lines="a-b">` marker, since its own markup can't carry attributes. With a
 * `sourceNonce` in the render environment, both values are `<nonce>:a-b`, so a document's own
 * raw HTML can't pass for them.
 */
export function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
  md.use(footnote);
  md.use(emoji, { shortcuts: {} });
  md.block.ruler.before('table', 'beuve_front_matter', (state, startLine, endLine, silent) => {
    return isFrontMatter({ state, startLine, endLine, isSilent: silent });
  });
  md.core.ruler.before('inline', 'beuve_markers', markers);
  md.core.ruler.push('beuve_source_lines', sourceLines);
  md.renderer.rules.html_block = (tokens, index, ...[, env]: unknown[]): string => {
    return htmlBlockFrom({ token: tokens[index], env });
  };
  return md;
}

/** Where a block rule is asked to match. */
interface BlockRuleCall {
  readonly state: StateBlock;
  readonly startLine: number;
  readonly endLine: number;
  /** Only say whether it would match. */
  readonly isSilent: boolean;
}

/** YAML front matter on the first line, as GitHub shows it: here, a `yaml` code block. */
function isFrontMatter({ state, startLine, endLine, isSilent }: BlockRuleCall): boolean {
  if (startLine !== 0 || lineText(state, 0) !== '---') {
    return false;
  }
  let close = 1;
  while (close < endLine && !frontMatterEnd.has(lineText(state, close))) {
    close += 1;
  }
  if (close >= endLine) {
    return false;
  }
  if (isSilent) {
    return true;
  }
  const token = state.push('fence', 'code', 0);
  token.info = 'yaml';
  token.markup = '---';
  token.content = state.getLines(1, close, 0, true);
  token.map = [0, close + 1];
  state.line = close + 1;
  return true;
}

/** Task list items and GitHub alerts, read from their first paragraph's source text. */
function markers(state: StateCore): void {
  const { tokens } = state;
  for (const [index, token] of tokens.entries()) {
    const paragraph = tokens[index - 1];
    const container = tokens[index - 2];
    if (
      container === undefined ||
      token.type !== 'inline' ||
      paragraph?.type !== 'paragraph_open'
    ) {
      continue;
    }
    if (container.type === 'list_item_open') {
      const task = taskMarker.exec(token.content);
      if (task === null) {
        continue;
      }
      container.attrSet('data-task', taskStates[task[1] ?? ' '] ?? 'open');
      token.content = token.content.slice(task[0].length);
    } else if (container.type === 'blockquote_open') {
      const alert = alertMarker.exec(token.content);
      if (alert?.[1] === undefined) {
        continue;
      }
      container.attrSet('data-alert', alert[1].toLowerCase());
      token.content = token.content.slice(alert[0].length);
      if (token.content.trim() === '') {
        paragraph.hidden = true;
        hideClose(tokens, index);
      }
    }
  }
}

/** Hides the `paragraph_close` after inline token `index`, as a tight list's paragraphs are. */
function hideClose(tokens: Token[], index: number): void {
  const close = tokens[index + 1];
  if (close?.type === 'paragraph_close') {
    close.hidden = true;
  }
}

function sourceLines(state: StateCore): void {
  const lines = state.src.split('\n');
  for (const token of state.tokens) {
    if (token.type === 'th_open' || token.type === 'td_open') {
      alignFromStyle(token);
    }
    if (!regionTokens.has(token.type) || token.map === null) {
      continue;
    }
    const [start, end] = token.map;
    let last = end;
    while (last > start + 1 && (lines[last - 1] ?? '').trim() === '') {
      last -= 1;
    }
    token.attrSet('data-source-lines', linesValue({ env: state.env, start: start + 1, end: last }));
  }
}

/** A table cell's alignment as `align`, which the sanitizer keeps, instead of a `style`. */
function alignFromStyle(token: Token): void {
  const style = token.attrGet('style');
  if (style === null) {
    return;
  }
  // eslint-disable-next-line unicorn/no-null -- markdown-it's tokens have `null` for no attributes.
  token.attrs = token.attrs?.filter(([name]) => name !== 'style') ?? null;
  const align = textAlign.exec(style)?.[1];
  if (align !== undefined) {
    token.attrSet('align', align);
  }
}

function lineText(state: StateBlock, line: number): string {
  return state.src
    .slice((state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0), state.eMarks[line])
    .trimEnd();
}

/** What a value of `data-source-lines` or `data-html-lines` says, and the environment it is in. */
interface LinesValueInput {
  readonly env: unknown;
  readonly start: number;
  readonly end: number;
}

function linesValue({ env, start, end }: LinesValueInput): string {
  const lines = `${String(start)}-${String(end)}`;
  const nonce = (env as MarkdownEnv | undefined)?.sourceNonce;
  if (typeof nonce !== 'string') {
    return lines;
  }
  return `${nonce}:${lines}`;
}

/** A raw HTML block and the render environment. */
interface HtmlBlockInput {
  readonly token: Token | undefined;
  readonly env: unknown;
}

/** A raw HTML block as written, after a marker with its source lines. */
function htmlBlockFrom({ token, env }: HtmlBlockInput): string {
  if (token?.map === undefined || token.map === null) {
    return token?.content ?? '';
  }
  const [start, end] = token.map;
  const lines = linesValue({ env, start: start + 1, end });
  return `<span data-html-lines="${lines}"></span>${token.content}`;
}
