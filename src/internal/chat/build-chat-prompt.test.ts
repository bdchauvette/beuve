import { describe, expect, it } from 'vitest';

import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { ChatFile, ChatTurn } from './chat-question.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';

const budget: ChatPromptBudget = defaultChatPromptBudget;
const hunkNote = /\[beuve: hunks \d+-10 of 10 .* Read src\/huge\.ts for the rest\]/u;

function bigFile(path: string, hunks: number, linesPerHunk: number): ChatFile {
  const body = Array.from({ length: hunks }, (_, hunk) =>
    [
      `@@ -${String(hunk * 100 + 1)},1 +${String(hunk * 100 + 1)},${String(linesPerHunk)} @@`,
      ...Array.from({ length: linesPerHunk }, (_, line) => `+line ${String(hunk)}.${String(line)}`),
    ].join('\n'),
  ).join('\n');
  return {
    path,
    status: 'modified',
    binary: false,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}\n`,
  };
}

describe('buildChatPrompt', () => {
  it('is deterministic and holds the diff, the focus and the question, last', () => {
    const question = createChatQuestion({
      focus: { path: 'src/a.ts', startLine: 12, endLine: 13, excerpt: '+  return first.trim();\n' },
      impactFindings: [
        {
          path: 'src/a.ts',
          functionName: 'parse',
          startLine: 10,
          endLine: 14,
          value: 18,
          limit: 15,
          trend: 'worsened',
        },
      ],
    });
    const built = buildChatPrompt(question, budget);
    expect(buildChatPrompt(question, budget)).toEqual(built);
    expect(built.prompt).toContain('### modified src/a.ts');
    expect(built.prompt).toContain('### added src/b.ts');
    expect(built.prompt).toContain('`parse`: cognitive complexity 18 (limit 15, worsened)');
    expect(built.prompt).toContain('The reviewer is looking at src/a.ts, lines 12-13.');
    expect(
      built.prompt.trimEnd().endsWith('```text\nWhy does parse trim the first part?\n```'),
    ).toBe(true);
    expect(built.report).toMatchObject({
      includedFiles: 2,
      truncatedFiles: [],
      omittedFiles: [],
      omittedTurns: 0,
      focusTruncated: false,
      questionTruncated: false,
    });
  });

  it('puts the stated intent after the head line, fenced as untrusted, and bounds it', () => {
    const question = createChatQuestion({ intent: 'Fix the parser\n\nIt dropped the last part.' });
    const built = buildChatPrompt(question, budget);
    const intentAt = built.prompt.indexOf("## The author's stated intent");
    expect(intentAt).toBeGreaterThan(built.prompt.indexOf('# Change under review'));
    expect(intentAt).toBeLessThan(built.prompt.indexOf('## Diff'));
    expect(built.prompt).toContain('```markdown\nFix the parser\n\nIt dropped the last part.\n```');
    expect(built.report.intentTruncated).toBe(false);
    expect(built.system).toContain("author's stated intent");

    const long = buildChatPrompt(createChatQuestion({ intent: `${'x'.repeat(50)}\`\`\`tail` }), {
      ...budget,
      maxIntentChars: 20,
    });
    expect(long.report.intentTruncated).toBe(true);
    expect(long.prompt).toContain('[beuve: intent truncated; first 20 of 57 characters shown]');
    expect(long.prompt).not.toContain('tail');
  });

  it('omits the intent section when there is no intent or it is blank', () => {
    expect(buildChatPrompt(createChatQuestion(), budget).prompt).not.toContain('stated intent');
    expect(buildChatPrompt(createChatQuestion({ intent: '  \n ' }), budget).prompt).not.toContain(
      'stated intent',
    );
  });

  it('states the read-only, authoring-resistant rules and the citation grammar', () => {
    const { system } = buildChatPrompt(createChatQuestion(), budget);
    expect(system).toContain('Read, Grep and Glob');
    expect(system).toContain('never offer to make a change');
    expect(system).toContain('```diff');
    expect(system).toContain('[[path:start-end]]');
    expect(system).toContain('untrusted');
  });

  it('keeps leading hunks of a file over its budget and omits files past the total, saying so', () => {
    const small: ChatPromptBudget = { ...budget, maxChars: 6000, maxFileChars: 2500 };
    const question = createChatQuestion({
      files: [
        bigFile('src/huge.ts', 10, 30),
        bigFile('src/next.ts', 1, 40),
        bigFile('src/last.ts', 1, 200),
        { path: 'logo.png', status: 'added', binary: true, patch: 'Binary files differ\n' },
      ],
    });
    const built = buildChatPrompt(question, small);
    expect(built.prompt.length).toBeLessThanOrEqual(small.maxChars);
    expect(built.report.truncatedFiles).toEqual([
      { path: 'src/huge.ts', includedHunks: expect.any(Number) as number, totalHunks: 10 },
    ]);
    expect(built.prompt).toMatch(hunkNote);
    expect(built.report.omittedFiles).toEqual(
      expect.arrayContaining([
        { path: 'src/last.ts', reason: 'budget' },
        { path: 'logo.png', reason: 'binary' },
      ]),
    );
    expect(built.prompt).toContain('- src/last.ts (size budget)');
    expect(built.prompt).toContain('- logo.png (binary)');
  });

  it('drops the oldest turns first, with a notice, and truncates an oversized turn', () => {
    const turns: ChatTurn[] = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${String(index)}`,
    }));
    const limited = buildChatPrompt(createChatQuestion({ history: turns }), budget);
    expect(limited.report.omittedTurns).toBe(10);
    expect(limited.prompt).toContain(
      '[beuve: 10 earlier turns omitted; the oldest are dropped first]',
    );
    expect(limited.prompt).not.toContain('turn 9\n');
    expect(limited.prompt).toContain('turn 10\n');
    expect(limited.prompt).toContain('turn 29\n');

    const tight: ChatPromptBudget = { ...budget, maxHistoryChars: 400 };
    const long: ChatTurn[] = [
      { role: 'user', content: 'o'.repeat(90) },
      { role: 'user', content: 'q'.repeat(90) },
      { role: 'assistant', content: 'x'.repeat(500) },
    ];
    const truncated = buildChatPrompt(createChatQuestion({ history: long }), tight);
    expect(truncated.report).toMatchObject({ truncatedTurns: 1, omittedTurns: 1 });
    expect(truncated.prompt).toContain(
      '[beuve: turn truncated; first 100 of 500 characters shown]',
    );
    expect(truncated.prompt).toContain('q'.repeat(90));
    expect(truncated.prompt).not.toContain('o'.repeat(90));
  });

  it('fences untrusted text so it cannot close its fence, and truncates the focus excerpt', () => {
    const tight: ChatPromptBudget = { ...budget, maxFocusChars: 10 };
    const built = buildChatPrompt(
      createChatQuestion({
        question: 'What is ```this```?',
        focus: { path: 'src/b.ts', excerpt: '+export function b(): number {\n' },
      }),
      tight,
    );
    expect(built.prompt).toContain('````text\nWhat is ```this```?\n````');
    expect(built.prompt).toContain('The reviewer is looking at src/b.ts.');
    expect(built.prompt).toContain('[beuve: excerpt truncated; Read src/b.ts for the rest]');
    expect(built.report.focusTruncated).toBe(true);
  });
});
