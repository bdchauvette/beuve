// `markdown-it-emoji` 3's name → emoji table, which its types leave out (ADR 0123, 0144).
declare module 'markdown-it-emoji/lib/data/full.mjs' {
  /** GitHub's Unicode shortcodes without colons (`tada`, `+1`), each to its emoji. */
  const emojiByName: Readonly<Record<string, string>>;
  export default emojiByName;
}
