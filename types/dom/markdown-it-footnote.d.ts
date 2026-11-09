// `markdown-it-footnote` 4 is an ES module that ships no types; `@types/markdown-it-footnote`
// describes the CommonJS 3.x line, whose `MarkdownIt` type doesn't match markdown-it 14's (ADR 0123).
declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';

  /** Adds `[^label]` references and `[^label]: …` definitions, rendered at the end. */
  const footnote: PluginSimple;
  export default footnote;
}
