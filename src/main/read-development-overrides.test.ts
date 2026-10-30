import { describe } from 'vitest';

import { test } from './testing/test.ts';
import { readDevelopmentOverrides } from './read-development-overrides.ts';

function overridden(): Record<string, string> {
  return {
    BEUVE_GITHUB_API_URL: 'http://127.0.0.1:9999/',
    BEUVE_EDITOR_LAUNCH_LOG: '/tmp/editor-launches.jsonl',
    BEUVE_CLAUDE_PATH: '/opt/claude',
  };
}

describe('readDevelopmentOverrides', () => {
  test('applies the overrides in an unpackaged app', ({ expect }) => {
    const overrides = readDevelopmentOverrides(false, overridden());

    expect(overrides.githubApiBase?.href).toBe('http://127.0.0.1:9999/');
    expect(overrides.editorLaunchLog).toBe('/tmp/editor-launches.jsonl');
    expect(overrides.ignored).toStrictEqual([]);
  });

  test('applies none in a packaged app and names the ignored variables', ({ expect }) => {
    expect(readDevelopmentOverrides(true, overridden())).toStrictEqual({
      ignored: ['BEUVE_GITHUB_API_URL', 'BEUVE_EDITOR_LAUNCH_LOG'],
    });
  });

  test('ignores a GitHub API root that is not loopback even when unpackaged', ({ expect }) => {
    const overrides = readDevelopmentOverrides(false, {
      BEUVE_GITHUB_API_URL: 'https://example.com/',
    });

    expect(overrides.githubApiBase).toBeUndefined();
  });

  test('is empty with no environment', ({ expect }) => {
    expect(readDevelopmentOverrides(false, {})).toStrictEqual({ ignored: [] });
    expect(readDevelopmentOverrides(true, {})).toStrictEqual({ ignored: [] });
  });
});
