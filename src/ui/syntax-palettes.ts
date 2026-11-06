/*!
 * The syntax palettes copy Alabaster's colors:
 * Alabaster — Copyright (c) 2018 Nikita Prokopov (https://github.com/tonsky/sublime-scheme-alabaster)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
