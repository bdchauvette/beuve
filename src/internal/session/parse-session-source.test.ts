import { describe, expect, it } from 'vitest';

import { parseSessionSource } from './parse-session-source.ts';
import type { SessionSource } from './session.ts';

const local: SessionSource = {
  kind: 'local',
  repoPath: '/repos/beuve',
  baseRef: 'main',
  headRef: 'agent/fix',
};
const pull: SessionSource = {
  kind: 'github-pull-request',
  repoPath: '/repos/beuve',
  baseRef: 'main',
  host: 'github.com',
  owner: 'acme',
  repo: 'beuve',
  number: 42,
};

describe('parseSessionSource', () => {
  it('accepts well-formed sources', () => {
    expect(parseSessionSource(local)).toEqual({ ok: true, value: local });
    expect(parseSessionSource(pull)).toEqual({ ok: true, value: pull });
  });

  it.each<[string, SessionSource]>([
    ['relative repo path', { ...local, repoPath: 'repos/beuve' }],
    ['blank base ref', { ...local, baseRef: ' ' }],
    ['blank head ref', { ...local, headRef: '' }],
    ['blank owner', { ...pull, owner: '' }],
    ['zero number', { ...pull, number: 0 }],
    ['uppercase host', { ...pull, host: 'GitHub.com' }],
    ['host with a port', { ...pull, host: 'ghe.example.com:8443' }],
    ['fractional number', { ...pull, number: 1.5 }],
  ])('rejects a %s', (_label, source) => {
    expect(parseSessionSource(source)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-source' },
    });
  });
});
