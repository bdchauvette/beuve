import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { updateCask } from './update-cask.ts';

function cask(): string {
  return 'cask "x" do\n  version "0.1.0"\n  sha256 "0000"\n  url "https://e/v1"\nend\n';
}

describe('updateCask', () => {
  test('replaces version and sha256 only', ({ expect }) => {
    const digest = 'a'.repeat(64);
    expect(updateCask(cask(), '0.2.0', digest)).toBe(
      `cask "x" do\n  version "0.2.0"\n  sha256 "${digest}"\n  url "https://e/v1"\nend\n`,
    );
  });

  test('throws when a line is missing or the digest is malformed', ({ expect }) => {
    const digest = 'a'.repeat(64);
    expect(() => updateCask('cask "x" do\nend\n', '1.0.0', digest)).toThrow(/version/);
    expect(() => updateCask(cask(), '1.0.0', 'nope')).toThrow(/SHA-256/);
  });
});
