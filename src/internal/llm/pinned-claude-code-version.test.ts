import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe } from 'vitest';

import { pinnedClaudeCodeVersion } from './pinned-claude-code-version.ts';
import { test } from './testing/test.ts';

describe('pinnedClaudeCodeVersion', () => {
  test("is the Claude Code version the installed Agent SDK's package names", async ({ expect }) => {
    const entry = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    const file = path.join(path.dirname(entry), 'package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8')) as {
      readonly claudeCodeVersion?: string;
    };
    expect(manifest.claudeCodeVersion).toBe(pinnedClaudeCodeVersion);
  });
});
