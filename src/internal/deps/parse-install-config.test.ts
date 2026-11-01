import { describe } from 'vitest';

import { mergeInstallConfig } from './merge-install-config.ts';
import { parseInstallConfig } from './parse-install-config.ts';
import { test } from './testing/test.ts';

describe('parseInstallConfig (ADR 0092)', () => {
  test('reads steps, skips, the hook mode and a timeout', ({ expect }) => {
    const text = JSON.stringify({
      install: {
        skip: ['python', 'npm'],
        steps: [
          { run: ['make', 'deps'], cwd: './tools/../tools', env: { CI: '1' } },
          { run: ['./gen.sh'] },
        ],
        hook: 'instead',
        timeoutSeconds: 120,
      },
    });
    expect(parseInstallConfig({ text, source: '.beuve/config.json' })).toStrictEqual({
      ok: true,
      value: {
        skip: ['python', 'npm'],
        steps: [
          { run: ['make', 'deps'], cwd: 'tools', env: { CI: '1' } },
          { run: ['./gen.sh'], cwd: '', env: {} },
        ],
        hook: 'instead',
        timeoutSeconds: 120,
      },
    });
    expect(parseInstallConfig({ text: '{}', source: 'x' })).toStrictEqual({ ok: true, value: {} });
  });

  test.for([
    ['not JSON', '{', '.beuve/config.json: not JSON'],
    ['an unknown key', '{"instal": {}}', '.beuve/config.json: Unrecognized key: "instal"'],
    [
      'a step leaving the checkout',
      '{"install": {"steps": [{"run": ["x"], "cwd": "../outside"}]}}',
      '.beuve/config.json: install.steps.0.cwd: must be a relative path that stays inside the checkout',
    ],
    [
      'an absolute cwd',
      '{"install": {"steps": [{"run": ["x"], "cwd": "/etc"}]}}',
      '.beuve/config.json: install.steps.0.cwd: must be a relative path',
    ],
    [
      'a shell string instead of an argument vector',
      '{"install": {"steps": [{"run": "npm ci"}]}}',
      '.beuve/config.json: install.steps.0.run:',
    ],
    [
      'an unknown ecosystem',
      '{"install": {"skip": ["cobol"]}}',
      '.beuve/config.json: install.skip.0:',
    ],
    [
      'a bad variable name',
      '{"install": {"steps": [{"run": ["x"], "env": {"A B": "1"}}]}}',
      '.beuve/config.json: install.steps.0.env.A B:',
    ],
    [
      'a timeout too long',
      '{"install": {"timeoutSeconds": 100000}}',
      '.beuve/config.json: install.timeoutSeconds:',
    ],
  ] as const)('reports %s, naming the field', ([, text, message], { expect }) => {
    const parsed = parseInstallConfig({ text, source: '.beuve/config.json' });
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ error: expect.stringContaining(message) as unknown });
  });

  test('the Settings override wins field by field over the checkout’s file', ({ expect }) => {
    expect(
      mergeInstallConfig({
        checkout: { skip: ['go'], steps: [{ run: ['a'], cwd: '', env: {} }], timeoutSeconds: 60 },
        override: { steps: [{ run: ['b'], cwd: '', env: {} }], hook: 'instead' },
      }),
    ).toStrictEqual({
      skip: ['go'],
      steps: [{ run: ['b'], cwd: '', env: {} }],
      timeoutSeconds: 60,
      hook: 'instead',
    });
    expect(mergeInstallConfig({ checkout: undefined, override: undefined })).toStrictEqual({});
  });
});
