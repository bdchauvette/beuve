/** The rich views beuve has (ADR 0123). */
export type RichViewKind = 'markdown';

const markdownName = /\.(?:md|markdown)$/iu;

/** The rich view that shows `path` rendered, or `undefined` when it has none. Pure. */
export function richViewKindFrom(path: string): RichViewKind | undefined {
  if (markdownName.test(path)) {
    return 'markdown';
  }
  return undefined;
}
