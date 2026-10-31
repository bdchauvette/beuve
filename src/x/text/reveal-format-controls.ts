/**
 * Characters that change how text around them is shown, or are not shown at all: control
 * characters (`Cc`: tabs, newlines, escape), format characters (`Cf`: the bidi embeddings,
 * overrides and isolates U+202A–U+202E and U+2066–U+2069, the marks U+200E, U+200F and U+061C,
 * zero-width spaces and joiners, U+FEFF, tag characters), lone surrogates, line and paragraph
 * separators, every default-ignorable code point (variation selectors, Hangul fillers, the
 * combining grapheme joiner) and every space but U+0020. `⟨` (U+27E8) is in the set too, so that
 * a revealed text can be read back unambiguously.
 */
const hidden =
  // eslint-disable-next-line security/detect-unsafe-regex -- one character class and no quantifier: nothing to backtrack.
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{27E8}[\p{Zs}--\u{20}]]/gv;

/**
 * `text` with every character that could hide or reorder what is shown replaced by a visible
 * escape, `⟨U+202E⟩` (ADR 0082): `invoice<U+202E>gpj.ts`, which a browser shows as
 * `invoicest.jpg`, reads `invoice⟨U+202E⟩gpj.ts`. Text without such characters comes back
 * unchanged. The escape is injective (a literal `⟨` is escaped too), so `restoreFormatControls`
 * turns the result back into `text`.
 */
export function revealFormatControls(text: string): string {
  return text.replaceAll(hidden, (character) => {
    const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    return `⟨U+${hex}⟩`;
  });
}
