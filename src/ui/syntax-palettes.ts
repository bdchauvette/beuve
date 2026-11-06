/*!
 * The syntax palettes copy values from Radix Colors:
 * Radix Colors 3.0.0 — Copyright (c) 2021 Radix (https://github.com/radix-ui/colors)
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
 * The editor's colors, the muted color of keywords and punctuation, and the comment color: the
 * theme marks everything else with weight and slant (ADR 0025, 0119). Hex strings only: they reach
 * the DOM as inline styles the library writes (ADR 0018), so they repeat Radix values `index.css`
 * also holds.
 */
export interface SyntaxPalette {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly comment: string;
}

/**
 * Radix Colors 3.0.0 steps, by role (ADR 0119): the code background is the chrome's background
 * step, text gray 12, keywords and punctuation gray 11, comments amber 11. Gray is slate in light
 * and sage in dark, as in `index.css`.
 */
export const syntaxPalettes: Readonly<Record<'light' | 'dark', SyntaxPalette>> = Object.freeze({
  light: {
    background: '#f9f9fb',
    foreground: '#1c2024',
    muted: '#60646c',
    comment: '#ab6400',
  },
  dark: {
    background: '#101211',
    foreground: '#eceeed',
    muted: '#adb5b2',
    comment: '#ffca16',
  },
});
