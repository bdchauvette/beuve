import { safeHrefFrom } from '../safe-href-from.ts';

import { repositoryPathFrom } from './repository-path-from.ts';
import type { RepositoryReference } from './repository-path-from.ts';

/** Where a link in a rendered file goes (ADR 0123). */
export type LinkTarget =
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'fragment'; readonly id: string }
  | { readonly kind: 'file'; readonly path: string; readonly line?: number }
  | { readonly kind: 'none' };

const scheme = /^[a-z][\d+.a-z-]*:/iu;
const lineFragment = /^L(\d+)(?:$|-L\d+$)/u;

/**
 * What a link written in a repository file points at: an `http(s)` URL (opened through main), a
 * `#fragment` of the same file, another file of the repository (with the line of a `#L<n>`
 * fragment), or nothing beuve follows (`javascript:`, `mailto:`, protocol-relative, outside the
 * repository). Pure.
 */
export function linkTargetFrom({ file, reference: href }: RepositoryReference): LinkTarget {
  const trimmed = href.trim();
  if (trimmed === '') {
    return { kind: 'none' };
  }
  if (trimmed.startsWith('#')) {
    return { kind: 'fragment', id: decodedOr(trimmed.slice(1)) };
  }
  const external = safeHrefFrom(trimmed);
  if (external !== undefined) {
    return { kind: 'external', href: external };
  }
  if (scheme.test(trimmed) || trimmed.startsWith('//')) {
    return { kind: 'none' };
  }
  const [pathAndQuery = '', fragment = ''] = trimmed.split('#', 2);
  const [reference = ''] = pathAndQuery.split('?', 1);
  const path = repositoryPathFrom({ file, reference });
  if (path === undefined) {
    return { kind: 'none' };
  }
  const line = lineFragment.exec(fragment)?.[1];
  if (line === undefined) {
    return { kind: 'file', path };
  }
  return { kind: 'file', path, line: Number(line) };
}

function decodedOr(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
