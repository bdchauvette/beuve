import { describe } from 'vitest';

import { test } from './testing/test.ts';

import { createClaudeCodeEnvironment } from './create-claude-code-environment.ts';

describe('createClaudeCodeEnvironment', () => {
  test('keeps what the CLI needs for its own login and drops secrets and session leakage', ({
    expect,
  }) => {
    const environment = createClaudeCodeEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LC_ALL: 'C',
      https_proxy: 'http://proxy:3128',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
      ANTHROPIC_API_KEY: 'sk-secret',
      CLAUDE_CODE_SESSION_ID: 'outer-session',
      CLAUDECODE: '1',
      NODE_OPTIONS: '--require evil.js',
      ELECTRON_RUN_AS_NODE: '1',
      GITHUB_TOKEN: 'ghp_secret',
      UNSET: undefined,
    });
    expect(environment).toStrictEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LC_ALL: 'C',
      https_proxy: 'http://proxy:3128',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
    });
  });

  test('lets main add variables explicitly', ({ expect }) => {
    expect(
      createClaudeCodeEnvironment({ PATH: '/bin' }, { CLAUDE_CODE_USE_BEDROCK: '1' }),
    ).toStrictEqual({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1' });
  });
});
