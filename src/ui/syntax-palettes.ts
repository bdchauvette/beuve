/**
 * The colors of the four things Alabaster highlights, plus the editor's own (ADR 0025). Hex
 * strings only: they reach the DOM as inline styles the library writes (ADR 0018).
 */
export interface SyntaxPalette {
  readonly background: string;
  readonly foreground: string;
  readonly string: string;
  readonly constant: string;
  readonly comment: string;
  readonly definition: string;
}

/**
 * Nikita Prokopov's Alabaster (light) and Alabaster Dark, from the Sublime Text originals in
 * tonsky/sublime-scheme-alabaster: light comments are red, dark ones yellow, as there.
 */
export const syntaxPalettes: Readonly<Record<'light' | 'dark', SyntaxPalette>> = Object.freeze({
  light: {
    background: '#f7f7f7',
    foreground: '#000000',
    string: '#448c27',
    constant: '#7a3e9d',
    comment: '#aa3731',
    definition: '#325cc0',
  },
  dark: {
    background: '#0e1415',
    foreground: '#cecece',
    string: '#95cb82',
    constant: '#cc8bc9',
    comment: '#dfdf8e',
    definition: '#71ade7',
  },
});
