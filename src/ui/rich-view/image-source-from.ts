import { repositoryPathFrom } from './repository-path-from.ts';
import type { RepositoryReference } from './repository-path-from.ts';

/** Where an image in a rendered file comes from (ADR 0123). */
export type ImageSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline'; readonly uri: string }
  | { readonly kind: 'remote'; readonly host: string }
  | { readonly kind: 'none' };

const inlineImage = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/iu;
const scheme = /^[a-z][\d+.a-z-]*:/iu;
const queryOrFragment = /[?#]/u;

/**
 * Where an `<img>` source written in a repository file points: a file of the repository (read
 * at the view's commit through main), an image `data:` URI written inline, a remote host (never
 * loaded, ADR 0123), or nothing. Pure.
 */
export function imageSourceFrom({ file, reference: source }: RepositoryReference): ImageSource {
  const trimmed = source.trim();
  if (inlineImage.test(trimmed)) {
    return { kind: 'inline', uri: trimmed };
  }
  const remote = URL.parse(trimmed);
  if (remote !== null && (remote.protocol === 'http:' || remote.protocol === 'https:')) {
    return { kind: 'remote', host: remote.host };
  }
  if (trimmed.startsWith('//')) {
    return { kind: 'remote', host: URL.parse(`https:${trimmed}`)?.host ?? '' };
  }
  if (trimmed === '' || trimmed.startsWith('#') || scheme.test(trimmed)) {
    return { kind: 'none' };
  }
  const [reference = ''] = trimmed.split(queryOrFragment, 1);
  const path = repositoryPathFrom({ file, reference });
  if (path === undefined) {
    return { kind: 'none' };
  }
  return { kind: 'file', path };
}
