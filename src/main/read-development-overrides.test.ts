import { describe, expect, it } from 'vitest';

import { readDevelopmentOverrides } from './read-development-overrides.ts';

const overridden = {
  BEUVE_GITHUB_API_URL: 'http://127.0.0.1:9999/',
  BEUVE_EDITOR_LAUNCH_LOG: '/tmp/editor-launches.jsonl',
  BEUVE_CLAUDE_PATH: '/opt/claude',
};

describe('readDevelopmentOverrides', () => {
  it('applies the overrides in an unpackaged app', () => {
    const overrides = readDevelopmentOverrides(false, overridden);

    expect(overrides.githubApiBase?.href).toBe('http://127.0.0.1:9999/');
    expect(overrides.editorLaunchLog).toBe('/tmp/editor-launches.jsonl');
    expect(overrides.ignored).toEqual([]);
  });

  it('applies none in a packaged app and names the ignored variables', () => {
    expect(readDevelopmentOverrides(true, overridden)).toEqual({
      ignored: ['BEUVE_GITHUB_API_URL', 'BEUVE_EDITOR_LAUNCH_LOG'],
    });
  });

  it('ignores a GitHub API root that is not loopback even when unpackaged', () => {
    const overrides = readDevelopmentOverrides(false, {
      BEUVE_GITHUB_API_URL: 'https://example.com/',
    });

    expect(overrides.githubApiBase).toBeUndefined();
  });

  it('is empty with no environment', () => {
    expect(readDevelopmentOverrides(false, {})).toEqual({ ignored: [] });
    expect(readDevelopmentOverrides(true, {})).toEqual({ ignored: [] });
  });
});
