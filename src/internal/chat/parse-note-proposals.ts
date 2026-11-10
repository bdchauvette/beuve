import type { ModelLines } from './diff-hunk-index.ts';
import { parseCitations } from './parse-citations.ts';

/**
 * One piece of a raw answer: Markdown, a well-formed `:::note` block (not yet checked against the
 * diff or the labels), or a block that did not parse.
 */
export type ProposalSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'block';
      readonly label: string;
      /** Written `(blocking)` after the label; `(non-blocking)` or nothing is not blocking. */
      readonly blocking: boolean;
      readonly lines: ModelLines;
      readonly title: string;
      readonly body: string;
    }
  | { readonly kind: 'malformed' };

/**
 * Splits an answer at its proposed review notes (ADR 0132). A proposal is a block whose first
 * line is `:::note <label> [(blocking)] [[path:start-end]] <optional title>` (the decoration as
 * Conventional Comments writes it, ADR 0131) and whose last is `:::`, both at
 * the start of a line and outside any fenced code block; the lines between are the body, in which
 * fenced code may hold a `:::` line. A block whose first line does not parse is dropped as
 * `malformed`; one that never closes is `malformed` too, and its lines stay text. Strict and pure:
 * a `:::note` anywhere else is ordinary text.
 */
export function parseNoteProposals(answer: string): ProposalSegment[] {
  const lines = answer.split(lineEnds);
  const segments: ProposalSegment[] = [];
  let text = '';
  const flushText = (): void => {
    if (text === '') {
      return;
    }
    segments.push({ kind: 'text', text });
    text = '';
  };
  let fence: Fence | undefined;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (fence !== undefined) {
      if (isFenceClose(line, fence)) {
        fence = undefined;
      }
      text += line;
      index += 1;
      continue;
    }
    fence = fenceOpenedBy(line);
    if (fence !== undefined || !opensBlock.test(line)) {
      text += line;
      index += 1;
      continue;
    }
    const end = closingLineOf(lines, index + 1);
    if (end === undefined) {
      flushText();
      segments.push({ kind: 'malformed' });
      text = lines.slice(index).join('');
      break;
    }
    flushText();
    segments.push(blockFrom({ opening: line, body: lines.slice(index + 1, end).join('') }));
    index = end + 1;
  }
  flushText();
  return segments;
}

/** Splits after each line ending, keeping it with its line. */
const lineEnds = /(?<=\n)/u;
const opensBlock = /^:::note(?:[ \t]|\r?\n|$)/u;
const blockKeyword = ':::note';
const labelPattern = /^[a-z][a-z-]{0,31}$/u;
const blank = /[ \t]/u;
const decorations = [
  { text: '(blocking)', blocking: true },
  { text: '(non-blocking)', blocking: false },
] as const;
const closingLine = /^:::[ \t]*\r?\n?$/u;
const fenceOpening = /^ {0,3}(`{3,}|~{3,})/u;

/** An open fenced code block: its fence character and length. */
interface Fence {
  readonly marker: string;
  readonly length: number;
}

function fenceOpenedBy(line: string): Fence | undefined {
  const marker = fenceOpening.exec(line)?.[1];
  if (marker === undefined) {
    return undefined;
  }
  if (marker.startsWith('`') && line.slice(line.indexOf(marker) + marker.length).includes('`')) {
    return undefined;
  }
  return { marker: marker.charAt(0), length: marker.length };
}

function isFenceClose(line: string, fence: Fence): boolean {
  const trimmed = line.trimEnd();
  const run = trimmed.trimStart();
  const indent = trimmed.length - run.length;
  return indent <= 3 && run.length >= fence.length && run.replaceAll(fence.marker, '') === '';
}

/** The index of the `:::` line that closes a block whose body starts at `from`. */
function closingLineOf(lines: readonly string[], from: number): number | undefined {
  let fence: Fence | undefined;
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fence !== undefined) {
      if (isFenceClose(line, fence)) {
        fence = undefined;
      }
      continue;
    }
    if (closingLine.test(line)) {
      return index;
    }
    fence = fenceOpenedBy(line);
  }
  return undefined;
}

/** A block's lines: its opening line, and the body between it and the closing `:::`. */
interface RawBlock {
  readonly opening: string;
  readonly body: string;
}

/**
 * `:::note <label> [(blocking)] [[path:start-end]] <title>`, tokens separated by spaces or tabs;
 * `(non-blocking)` is accepted and means what no decoration means.
 */
function blockFrom({ opening, body }: RawBlock): ProposalSegment {
  const rest = opening.trimEnd().slice(blockKeyword.length).trim();
  const labelEnd = rest.search(blank);
  const label = rest.slice(0, labelEnd);
  const decorated = rest.slice(labelEnd).trimStart();
  const decoration = decorations.find((candidate) => decorated.startsWith(candidate.text));
  let anchored = decorated;
  if (decoration !== undefined) {
    anchored = decorated.slice(decoration.text.length);
  }
  const isSeparated = decoration === undefined || blank.test(anchored.charAt(0));
  anchored = anchored.trimStart();
  const anchorEnd = anchored.indexOf(']]') + 2;
  const title = anchored.slice(anchorEnd);
  const marker = parseCitations(anchored.slice(0, anchorEnd)).markers[0];
  const isWellFormed =
    labelEnd > 0 &&
    labelPattern.test(label) &&
    isSeparated &&
    anchored.startsWith('[[') &&
    marker?.index === 0 &&
    (title === '' || blank.test(title.charAt(0)));
  if (!isWellFormed) {
    return { kind: 'malformed' };
  }
  const { path, startLine, endLine } = marker;
  return {
    kind: 'block',
    label,
    blocking: decoration?.blocking ?? false,
    lines: { path, startLine, endLine },
    title: title.trim(),
    body: body.trim(),
  };
}
