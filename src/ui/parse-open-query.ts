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
  /** Looks like a GitHub branch to follow (ADR 0112); main validates it strictly. */
  | {
      readonly kind: 'branch';
      readonly ref: string;
      readonly host: string;
      readonly owner: string;
      readonly repo: string;
      readonly branch: string;
    }
  /** An absolute or home-relative folder path. */
  | { readonly kind: 'path'; readonly path: string }
  /** Anything else filters the recent sessions. */
  | { readonly kind: 'filter'; readonly text: string };

const gitSuffix = /\.git$/u;
const segment = /^[^\s#/]+$/u;
const digits = /^\d{1,10}$/u;
const shorthandSegment = /^[^\s#/:]+$/u;
const branchName = /^\S+$/u;

/**
 * Classifies the open panel's input: a pull request URL or `owner/repo#n` (also
 * `host/owner/repo#n`), a branch's tree URL or `owner/repo:branch` (also `host/owner/repo:branch`),
 * a folder path (`/…` or `~/…`), or text that filters recent sessions. Lenient on purpose: it
 * only decides which action Enter offers. Pure.
 */
export function parseOpenQuery(input: string): OpenQuery {
  const text = input.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const parts = partsFrom(text);
  if (parts !== undefined) {
    return pullRequest(text, parts);
  }
  const branch = branchFrom(text);
  if (branch !== undefined) {
    return branch;
  }
  if (text === '~' || text.startsWith('/') || text.startsWith('~/')) {
    return { kind: 'path', path: text };
  }
  return { kind: 'filter', text };
}

function partsFrom(text: string): Parts | undefined {
  if (text.startsWith('https://')) {
    return fromUrl(text);
  }
  return fromShorthand(text);
}

function pullRequest(ref: string, [host, owner, repo, number]: Parts): OpenQuery {
  const value = Number(number);
  if (Number.isSafeInteger(value) && value > 0) {
    return {
      kind: 'pull-request',
      ref,
      host: host.toLowerCase(),
      owner,
      repo: repo.replace(gitSuffix, ''),
      number: value,
    };
  }
  return { kind: 'filter', text: ref };
}

type Parts = readonly [host: string, owner: string, repo: string, number: string];

function fromUrl(text: string): Parts | undefined {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const url = new URL(text);
  const [owner = '', repo = '', kind, number = ''] = url.pathname.split('/').slice(1);
  if (kind === 'pull' && owner !== '' && repo !== '' && digits.test(number)) {
    return [url.hostname, owner, repo, number];
  }
  return undefined;
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
  if (third !== undefined && segments.length === 3) {
    return [first, second, third, number];
  }
  return undefined;
}

function branchFrom(text: string): OpenQuery | undefined {
  if (text.startsWith('https://')) {
    const url = URL.parse(text);
    const [owner = '', repo = '', kind, ...rest] = url?.pathname.split('/').slice(1) ?? [];
    const branch = rest.filter((part) => part !== '').join('/');
    if (url === null || kind !== 'tree' || owner === '' || repo === '' || branch === '') {
      return undefined;
    }
    return { kind: 'branch', ref: text, host: url.hostname, owner, repo, branch };
  }
  const colon = text.indexOf(':');
  const branch = text.slice(colon + 1);
  const segments = text.slice(0, colon).split('/');
  if (
    colon === -1 ||
    !branchName.test(branch) ||
    segments.some((part) => !shorthandSegment.test(part))
  ) {
    return undefined;
  }
  const [first = '', second = '', third] = segments;
  if (segments.length === 2) {
    return { kind: 'branch', ref: text, host: 'github.com', owner: first, repo: second, branch };
  }
  if (third !== undefined && segments.length === 3) {
    return {
      kind: 'branch',
      ref: text,
      host: first.toLowerCase(),
      owner: second,
      repo: third,
      branch,
    };
  }
  return undefined;
}
