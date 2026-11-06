import { parseCommitTrailers } from '#internal/git/parse-commit-trailers.ts';

const trailerKey = 'claude-session';

/**
 * The agent session a commit came from (ADR 0112): the last `Claude-Session:` trailer of its
 * message whose value is a plain `https://` URL (no credentials), as cloud agents write it.
 * `undefined` when there is none. Pure.
 */
export function agentSessionUrlFrom(message: string): string | undefined {
  const values = parseCommitTrailers(message)
    .filter(({ key }) => key.toLowerCase() === trailerKey)
    .map(({ value }) => URL.parse(value))
    .filter((url) => {
      return url?.protocol === 'https:' && url.username === '' && url.password === '';
    });
  return values.at(-1)?.href;
}
