/** What the reviewer typed into the open panel's single input. */
export type OpenQuery =
  | { readonly kind: 'empty' }
  /** Looks like a pull request; main validates it strictly (ADR 0037). */
  | {
      readonly kind: 'pull-request';
      readonly ref: string;
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    }
  /** An absolute or home-relative folder path. */
  | { readonly kind: 'path'; readonly path: string }
  /** Anything else filters the recent sessions. */
  | { readonly kind: 'filter'; readonly text: string };

const gitSuffix = /\.git$/u;
const segment = /^[^\s#/]+$/u;
const digits = /^\d{1,10}$/u;

/**
 * Classifies the open panel's input: a pull request URL or `owner/repo#n` (also
 * `host/owner/repo#n`), a folder path (`/…` or `~/…`), or text that filters recent sessions.
 * Lenient on purpose: it only decides which action Enter offers. Pure.
 */
export function parseOpenQuery(input: string): OpenQuery {
  const text = input.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const parts = text.startsWith('https://') ? fromUrl(text) : fromShorthand(text);
  if (parts !== undefined) {
    const [host, owner, repo, number] = parts;
    return pullRequest(text, host.toLowerCase(), owner, repo, number);
  }
  return text === '~' || text.startsWith('/') || text.startsWith('~/')
    ? { kind: 'path', path: text }
    : { kind: 'filter', text };
}

function pullRequest(
  ref: string,
  host: string,
  owner: string,
  repo: string,
  number: string,
): OpenQuery {
  const value = Number(number);
  return Number.isSafeInteger(value) && value > 0
    ? { kind: 'pull-request', ref, host, owner, repo: repo.replace(gitSuffix, ''), number: value }
    : { kind: 'filter', text: ref };
}

type Parts = readonly [host: string, owner: string, repo: string, number: string];

function fromUrl(text: string): Parts | undefined {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const url = new URL(text);
  const [owner = '', repo = '', kind, number = ''] = url.pathname.split('/').slice(1);
  return kind === 'pull' && owner !== '' && repo !== '' && digits.test(number)
    ? [url.hostname, owner, repo, number]
    : undefined;
}

function fromShorthand(text: string): Parts | undefined {
  const [path = '', number = '', ...extra] = text.split('#');
  const segments = path.split('/');
  if (extra.length > 0 || !digits.test(number) || segments.some((part) => !segment.test(part))) {
    return undefined;
  }
  const [first = '', second = '', third] = segments;
  if (segments.length === 2) {
    return ['github.com', first, second, number];
  }
  return third !== undefined && segments.length === 3 ? [first, second, third, number] : undefined;
}
