import { describe, expect, it } from 'vitest';

import { updateCask } from './update-cask.ts';

const versionError = /version/;
const digestError = /SHA-256/;
const digest = 'a'.repeat(64);
const cask = 'cask "x" do\n  version "0.1.0"\n  sha256 "0000"\n  url "https://e/v1"\nend\n';

describe('updateCask', () => {
  it('replaces version and sha256 only', () => {
    expect(updateCask(cask, '0.2.0', digest)).toBe(
      `cask "x" do\n  version "0.2.0"\n  sha256 "${digest}"\n  url "https://e/v1"\nend\n`,
    );
  });

  it('throws when a line is missing or the digest is malformed', () => {
    expect(() => updateCask('cask "x" do\nend\n', '1.0.0', digest)).toThrow(versionError);
    expect(() => updateCask(cask, '1.0.0', 'nope')).toThrow(digestError);
  });
});
