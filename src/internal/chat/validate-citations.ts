import type { Citation } from './chat-message.ts';
import type { ParsedCitations } from './parse-citations.ts';

export interface CitationScope {
  /** Repository-relative paths an answer may cite: the diff's and the head worktree's files. */
  readonly knownPaths: ReadonlySet<string>;
  /** The worktree's absolute path; a citation by absolute path inside it is made relative. */
  readonly worktreePath?: string | undefined;
}

/** A well-formed citation of a file that is in neither the diff nor the worktree listing. */
export interface DroppedCitation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly reason: 'unknown-path';
}

export interface ValidatedAnswer {
  /**
   * The answer with every kept marker rewritten to the canonical `[[path:start-end]]` and every
   * dropped one to plain code (`` `path:start-end` ``), so each marker left is a valid citation.
   */
  readonly content: string;
  /** Kept citations, deduplicated, in order of first appearance. */
  readonly citations: readonly Citation[];
  readonly dropped: readonly DroppedCitation[];
  readonly malformed: number;
}

/**
 * Checks an answer's citations against the files it may cite (ADR 0031). Pure: the caller passes
 * the path set. Line numbers are not checked against file lengths.
 */
export function validateCitations(
  answer: string,
  parsed: ParsedCitations,
  scope: CitationScope,
): ValidatedAnswer {
  const prefix = directoryPrefix(scope.worktreePath);
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const dropped: DroppedCitation[] = [];
  let content = '';
  let cursor = 0;
  for (const marker of parsed.markers) {
    let { path } = marker;
    if (prefix !== undefined && path.startsWith(prefix)) {
      path = path.slice(prefix.length);
    }
    const lines = `${String(marker.startLine)}-${String(marker.endLine)}`;
    content += answer.slice(cursor, marker.index);
    cursor = marker.index + marker.length;
    if (!scope.knownPaths.has(path)) {
      dropped.push({
        path,
        startLine: marker.startLine,
        endLine: marker.endLine,
        reason: 'unknown-path',
      });
      content += codeSpan(`${path}:${lines}`);
      continue;
    }
    content += `[[${path}:${lines}]]`;
    const key = `${path}:${lines}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    citations.push({ path, startLine: marker.startLine, endLine: marker.endLine, side: 'head' });
  }
  content += answer.slice(cursor);
  return { content, citations, dropped, malformed: parsed.malformed };
}

/** The worktree path with a trailing `/`, for stripping it from absolute citations. */
function directoryPrefix(root: string | undefined): string | undefined {
  if (root === undefined || root.endsWith('/')) {
    return root;
  }
  return `${root}/`;
}

/** `text` as inline code, or as it is when a backtick in it would break the span. */
function codeSpan(text: string): string {
  if (text.includes('`')) {
    return text;
  }
  return `\`${text}\``;
}
