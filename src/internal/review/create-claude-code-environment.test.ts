import { describe, expect, it } from 'vitest';

import { createClaudeCodeEnvironment } from './create-claude-code-environment.ts';

describe('createClaudeCodeEnvironment', () => {
  it('keeps what the CLI needs for its own login and drops secrets and session leakage', () => {
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
    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LC_ALL: 'C',
      https_proxy: 'http://proxy:3128',
      CLAUDE_CONFIG_DIR: '/Users/me/.claude-work',
    });
  });

  it('lets main add variables explicitly', () => {
    expect(createClaudeCodeEnvironment({ PATH: '/bin' }, { CLAUDE_CODE_USE_BEDROCK: '1' })).toEqual(
      { PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1' },
    );
  });
});
