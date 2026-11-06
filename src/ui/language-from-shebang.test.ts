import { describe } from 'vitest';

import { highlightedLanguages } from './highlighted-languages.ts';
import { languageFromShebang } from './language-from-shebang.ts';
import { test } from './testing/test.ts';

describe('languageFromShebang', () => {
  test.for<[string | undefined, string | undefined]>([
    ['#!/bin/sh', 'shellscript'],
    ['#!/bin/bash -euo pipefail', 'shellscript'],
    ['#!/usr/bin/env bash', 'shellscript'],
    ['#! /usr/bin/env zsh', 'shellscript'],
    ['#!/usr/bin/env -S python3 -u', 'python'],
    ['#!/usr/bin/python3.12', 'python'],
    ['#!/usr/bin/env LANG=C perl5 -w', 'perl'],
    ['#!/usr/bin/env ruby', 'ruby'],
    ['#!/usr/local/bin/fish', 'fish'],
    ['#!/usr/bin/awk -f', 'awk'],
    ['#!/usr/bin/env gawk -f', 'awk'],
    ['#!/usr/bin/env node', 'javascript'],
    ['#!/usr/bin/env -S deno run --allow-read', 'typescript'],
    ['#!/usr/bin/env tclsh', undefined],
    ['#!', undefined],
    ['# not a shebang', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%j', ([line, expected], { expect }) => {
    expect(languageFromShebang(line)).toBe(expected);
  });

  test('names only languages beuve highlights', ({ expect }) => {
    const names = ['sh', 'fish', 'python', 'ruby', 'perl', 'node', 'deno', 'awk'].map((program) => {
      return languageFromShebang(`#!/usr/bin/env ${program}`);
    });
    for (const name of names) {
      expect(Object.hasOwn(highlightedLanguages, name ?? '')).toBe(true);
    }
  });
});
