# Third-party notices

beuve's own code is under the [0BSD license](LICENSE). The works below were copied in part into beuve's source rather than installed as dependencies, so their notices live here and, for what ships, in a `/*! … */` comment that esbuild keeps in the bundle. Dependencies installed through npm carry their own license files.

## Copied

| Work                                                              | License | What beuve copies                                                                                                                                                                   | Where                                                                                                                                                     |
| ----------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Radix Colors](https://github.com/radix-ui/colors) 3.0.0          | MIT     | Hex values of the slate, sage, indigo, violet, pink, green, red, amber, blue and orange scales and their alpha variants, light and dark, and the role each step plays               | `src/ui/index.css` (`--beuve-scale-*`), `src/ui/syntax-palettes.ts`, [ADR 0114](docs/adr/0114-design-tokens-logical-properties-and-diff-color-schemes.md) |
| [Primer Primitives](https://github.com/primer/primitives) 11.10.0 | MIT     | The type scale (12, 14, 16, 20 px and the 13 px code size), line heights, the 4 px spacing scale and radii; the line, number and word structure of the `diffBlob` tokens. No colors | `src/ui/index.css`, ADR 0114                                                                                                                              |

## Drawn on, nothing copied

These shaped decisions in ADR 0114 and ADR 0119; no values, code or text came from them.

- [Alabaster](https://github.com/tonsky/sublime-scheme-alabaster) by Nikita Prokopov: few highlighted classes and greyed punctuation. beuve copied its colors until ADR 0119 replaced them with Radix steps and font styles.
- GitHub's colorblind themes (part of Primer): blue for additions and orange for deletions.
- JetBrains IDEs' diff viewer: deleted lines in grey.
- Review Board and Bitbucket: blue and yellow diffs (not adopted).

## License texts

### Radix Colors

```text
MIT License

Copyright (c) 2021 Radix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Primer Primitives

```text
MIT License

Copyright (c) 2018 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
