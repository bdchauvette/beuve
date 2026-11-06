/** One `Key: value` line of a commit message's trailer block. */
export interface CommitTrailer {
  readonly key: string;
  readonly value: string;
}

const trailerLine = /^([A-Za-z\d][\w-]*):[ \t]*(.*)$/u;
const continuation = /^[ \t]/u;
const paragraphBreak = /\n[ \t]*\n/u;

/**
 * The trailers of a commit message (`Co-Authored-By: …`, `Claude-Session: …`): its last paragraph,
 * when every line of it is a `Key: value` line or the indented continuation of one. Values are
 * trimmed and continuations joined with a space. A message whose last paragraph is prose has
 * none. Stricter than `git interpret-trailers`, which tolerates some prose lines. Pure.
 */
export function parseCommitTrailers(message: string): readonly CommitTrailer[] {
  const paragraphs = message.replaceAll('\r\n', '\n').trimEnd().split(paragraphBreak);
  const last = paragraphs.at(-1);
  if (last === undefined || paragraphs.length < 2) {
    return [];
  }
  const trailers: { key: string; value: string }[] = [];
  for (const line of last.split('\n')) {
    const previous = trailers.at(-1);
    if (previous !== undefined && continuation.test(line)) {
      previous.value = `${previous.value} ${line.trim()}`.trim();
      continue;
    }
    const match = trailerLine.exec(line);
    if (match === null) {
      return [];
    }
    trailers.push({ key: match[1] ?? '', value: (match[2] ?? '').trim() });
  }
  return trailers;
}
