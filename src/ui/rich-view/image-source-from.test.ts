import { describe } from 'vitest';

import { test } from '../testing/test.ts';

import { imageSourceFrom } from './image-source-from.ts';
import type { ImageSource } from './image-source-from.ts';

describe('imageSourceFrom', () => {
  test.for<[string, ImageSource]>([
    ['img/shot.png', { kind: 'file', path: 'docs/img/shot.png' }],
    ['/assets/logo.svg?raw=true', { kind: 'file', path: 'assets/logo.svg' }],
    ['data:image/png;base64,AAAA', { kind: 'inline', uri: 'data:image/png;base64,AAAA' }],
    ['data:text/html,<script>', { kind: 'none' }],
    ['https://img.shields.io/badge/x', { kind: 'remote', host: 'img.shields.io' }],
    ['//cdn.example.com/a.png', { kind: 'remote', host: 'cdn.example.com' }],
    ['javascript:alert(1)', { kind: 'none' }],
    ['../../up.png', { kind: 'none' }],
  ])('%s', ([source, expected], { expect }) => {
    expect(imageSourceFrom({ file: 'docs/guide.md', reference: source })).toStrictEqual(expected);
  });
});
