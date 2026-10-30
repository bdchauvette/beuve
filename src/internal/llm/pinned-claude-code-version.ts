/**
 * The Claude Code version the pinned Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.312) bundles
 * and speaks to (its `package.json` `claudeCodeVersion`, ADR 0069). An installed `claude` the
 * SDK drives must be at least this version (ADR 0070); a test keeps it in step with the package.
 */
export const pinnedClaudeCodeVersion = '2.1.312';
