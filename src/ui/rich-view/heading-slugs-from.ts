const dropped = /[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu;

/**
 * The ids GitHub gives headings with these texts, in document order (ADR 0123): lower case,
 * punctuation and symbols dropped, spaces as hyphens, and a repeated slug numbered `-1`, `-2`, …
 * so `#fragment` links into a rendered file land where they do on GitHub. Pure.
 */
export function headingSlugsFrom(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = text.toLowerCase().replaceAll(dropped, '').replaceAll(' ', '-');
    let slug = base;
    for (let count = seen.get(base) ?? 0; seen.has(slug); count += 1) {
      slug = `${base}-${String(count + 1)}`;
      seen.set(base, count + 1);
    }
    seen.getOrInsert(slug, 0);
    return slug;
  });
}
