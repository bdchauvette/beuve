import { describe } from 'vitest';

import { test } from '../testing/test.ts';
import { describeNodeRuntimeError } from './describe-node-runtime-error.ts';

describe('describeNodeRuntimeError', () => {
  test('tells a packaged app to reinstall when its Node is missing', ({ expect }) => {
    expect(
      describeNodeRuntimeError({
        kind: 'missing',
        source: 'bundled',
        searched: ['/Applications/beuve.app/Contents/Resources/node/node'],
      }),
    ).toBe(
      "beuve's bundled Node is missing (/Applications/beuve.app/Contents/Resources/node/node); reinstall beuve.",
    );
  });

  test('names the requirement when PATH has no node', ({ expect }) => {
    expect(
      describeNodeRuntimeError({ kind: 'missing', source: 'path', searched: ['/usr/bin/node'] }),
    ).toBe(
      'No node on PATH. Unpackaged beuve runs language servers and trace probes with the node on PATH, which must be Node 26 or later (.node-version).',
    );
  });

  test('names the version found and where', ({ expect }) => {
    expect(
      describeNodeRuntimeError({
        kind: 'too-old',
        command: '/opt/node22/bin/node',
        version: '22.22.0',
        minimumMajor: 26,
      }),
    ).toBe(
      'Language servers and trace probes need Node 26 or later; found 22.22.0 at /opt/node22/bin/node.',
    );
  });

  test('passes on why node could not run', ({ expect }) => {
    expect(
      describeNodeRuntimeError({ kind: 'unrunnable', command: '/bin/node', reason: 'EACCES' }),
    ).toBe('/bin/node could not report its version: EACCES');
  });
});
