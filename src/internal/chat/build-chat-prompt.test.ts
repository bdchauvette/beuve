import { describe } from 'vitest';

import { buildChatPrompt } from './build-chat-prompt.ts';
import type { ChatPromptBudget } from './build-chat-prompt.ts';
import type { ChatFile, ChatTurn } from './chat-question.ts';
import { defaultChatPromptBudget } from './default-chat-prompt-budget.ts';
import { createChatQuestion } from './testing/create-chat-question.ts';
import { test } from './testing/test.ts';

function bigFile(path: string, hunks: number, linesPerHunk: number): ChatFile {
  const body = Array.from({ length: hunks }, (_, hunk) => {
    return [
      `@@ -${String(hunk * 100 + 1)},1 +${String(hunk * 100 + 1)},${String(linesPerHunk)} @@`,
      ...Array.from({ length: linesPerHunk }, (_, line) => `+line ${String(hunk)}.${String(line)}`),
    ].join('\n');
  }).join('\n');
  return {
    path,
    status: 'modified',
    binary: false,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}\n`,
  };
}

describe('buildChatPrompt', () => {
  test('puts a command task in place of the question, with its own instructions', ({ expect }) => {
    const review = buildChatPrompt(
      createChatQuestion({
        question: 'ignored',
        task: { kind: 'review', pathScope: ['src'], maxFindings: 5 },
      }),
      budget(),
    );
    expect(review.prompt).toContain('## Task');
    expect(review.prompt).toContain('only the files at or under src');
    expect(review.prompt).toContain('at most\n5 findings');
    expect(review.prompt).not.toContain('ignored');
    expect(review.system).toContain('at most 5');
    expect(review.system).toContain('structured output');

    const abstract = buildChatPrompt(createChatQuestion({ task: { kind: 'abstract' } }), budget());
    expect(abstract.prompt).toContain("Write beuve's own summary of this change");
    expect(abstract.prompt).not.toContain("## The reviewer's question");
    expect(abstract.system).toContain('**What changed**');
    expect(abstract.system).toContain('"Inferred:"');
    expect(abstract.system).toContain('[[path:start-end]]');
  });

  test('is deterministic and holds the diff, the focus and the question, last', ({ expect }) => {
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
    const built = buildChatPrompt(question, budget());
    expect(buildChatPrompt(question, budget())).toStrictEqual(built);
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

  test('puts the stated intent after the head line, fenced as untrusted, and bounds it', ({
    expect,
  }) => {
    const question = createChatQuestion({ intent: 'Fix the parser\n\nIt dropped the last part.' });
    const built = buildChatPrompt(question, budget());
    const intentAt = built.prompt.indexOf("## The author's stated intent");
    expect(intentAt).toBeGreaterThan(built.prompt.indexOf('# Change under review'));
    expect(intentAt).toBeLessThan(built.prompt.indexOf('## Diff'));
    expect(built.prompt).toContain('```markdown\nFix the parser\n\nIt dropped the last part.\n```');
    expect(built.report.intentTruncated).toBe(false);
    expect(built.system).toContain("author's stated intent");

    const long = buildChatPrompt(createChatQuestion({ intent: `${'x'.repeat(50)}\`\`\`tail` }), {
      ...budget(),
      maxIntentChars: 20,
    });
    expect(long.report.intentTruncated).toBe(true);
    expect(long.prompt).toContain('[beuve: intent truncated; first 20 of 57 characters shown]');
    expect(long.prompt).not.toContain('tail');
  });

  test('omits the intent section when there is no intent or it is blank', ({ expect }) => {
    expect(buildChatPrompt(createChatQuestion(), budget()).prompt).not.toContain('stated intent');
    expect(buildChatPrompt(createChatQuestion({ intent: '  \n ' }), budget()).prompt).not.toContain(
      'stated intent',
    );
  });

  test('states the read-only, authoring-resistant rules and the citation grammar', ({ expect }) => {
    const { system } = buildChatPrompt(createChatQuestion(), budget());
    expect(system).toContain('Read, Grep and Glob');
    expect(system).toContain('never offer to make a change');
    expect(system).toContain('```diff');
    expect(system).toContain('[[path:start-end]]');
    expect(system).toContain('untrusted');
  });

  test('keeps leading hunks of a file over its budget and omits files past the total, saying so', ({
    expect,
  }) => {
    const small: ChatPromptBudget = { ...budget(), maxChars: 6000, maxFileChars: 2500 };
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
    expect(built.report.truncatedFiles).toStrictEqual([
      { path: 'src/huge.ts', includedHunks: expect.any(Number) as number, totalHunks: 10 },
    ]);
    expect(built.prompt).toMatch(
      /\[beuve: hunks \d+-10 of 10 .* Read src\/huge\.ts for the rest\]/u,
    );
    expect(built.report.omittedFiles).toStrictEqual(
      expect.arrayContaining([
        { path: 'src/last.ts', reason: 'budget' },
        { path: 'logo.png', reason: 'binary' },
      ]),
    );
    expect(built.prompt).toContain('- src/last.ts (size budget)');
    expect(built.prompt).toContain('- logo.png (binary)');
  });

  test('sends the change as a cached first message and the question as the second', ({
    expect,
  }) => {
    const built = buildChatPrompt(createChatQuestion(), budget());
    expect(
      built.messages.map((message) => {
        return [message.role, message.cache === true];
      }),
    ).toStrictEqual([
      ['user', true],
      ['user', false],
    ]);
    expect(built.messages[0]?.content.startsWith('# Change under review')).toBe(true);
    expect(built.messages[1]?.content).toContain("## The reviewer's question");
    expect(built.prompt).toBe(built.messages.map((message) => message.content).join('\n'));
  });

  test('never points a model without tools at the worktree', ({ expect }) => {
    const small: ChatPromptBudget = { ...budget(), maxChars: 6000, maxFileChars: 2500 };
    const question = createChatQuestion({
      files: [bigFile('src/huge.ts', 10, 30), bigFile('src/last.ts', 1, 400)],
    });
    for (const task of [
      undefined,
      { kind: 'review', pathScope: [], maxFindings: 5 },
      { kind: 'abstract' },
    ] as const) {
      const built = buildChatPrompt({ ...question, ...(task !== undefined && { task }) }, small, {
        tools: false,
      });
      const text = `${built.system}\n${built.prompt}`;
      expect(text).not.toMatch(/\bRead\b|Grep|Glob|working directory is/u);
      expect(built.system).toContain('You cannot read files');
    }
    const withTools = buildChatPrompt(question, small);
    expect(`${withTools.system}\n${withTools.prompt}`).toMatch(/Read src\/huge\.ts for the rest/u);
  });

  test('drops the oldest turns first, with a notice, and truncates an oversized turn', ({
    expect,
  }) => {
    const turns: ChatTurn[] = Array.from({ length: 30 }, (_, index) => {
      return {
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${String(index)}`,
      };
    });
    const limited = buildChatPrompt(createChatQuestion({ history: turns }), budget());
    expect(limited.report.omittedTurns).toBe(10);
    expect(limited.prompt).toContain(
      '[beuve: 10 earlier turns omitted; the oldest are dropped first]',
    );
    expect(limited.prompt).not.toContain('turn 9\n');
    expect(limited.prompt).toContain('turn 10\n');
    expect(limited.prompt).toContain('turn 29\n');

    const tight: ChatPromptBudget = { ...budget(), maxHistoryChars: 400 };
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

  test('fences untrusted text so it cannot close its fence, and truncates the focus excerpt', ({
    expect,
  }) => {
    const tight: ChatPromptBudget = { ...budget(), maxFocusChars: 10 };
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

describe('buildChatPrompt with selections and a summary', () => {
  const head = createChatQuestion().headSha;

  test('puts the selections in the request after the cached change, numbered as in the file', ({
    expect,
  }) => {
    const built = buildChatPrompt(
      createChatQuestion({
        question: 'Why does [[@1]] differ from [[@2]]?',
        selections: [
          {
            kind: 'lines',
            path: 'src/a.ts',
            side: 'head',
            sha: head,
            startLine: 9,
            endLine: 11,
            totalLines: 40,
            isWholeFile: false,
            lines: lines(9, 3),
          },
          {
            kind: 'lines',
            path: 'src/a.ts',
            side: 'base',
            sha: createChatQuestion().baseSha,
            startLine: 10,
            endLine: 10,
            totalLines: 30,
            isWholeFile: false,
            lines: ['  return parts[0];'],
          },
          { kind: 'unreadable', path: 'logo.png', side: 'head', sha: head, reason: 'binary' },
        ],
      }),
      budget(),
    );
    const { prompt } = built;
    const [change, request] = built.messages;
    expect(change?.cache).toBe(true);
    expect(change?.content).toContain('## Diff');
    expect(change?.content).not.toContain('## Selected by the reviewer');
    expect(request?.content.startsWith('## Selected by the reviewer')).toBe(true);
    expect(prompt).toContain(`### Selection 1: src/a.ts:9-11 (head ${head.slice(0, 12)})`);
    expect(prompt).toContain(' 9  const v9 = 0;\n10  const v10 = 1;\n11  const v11 = 2;\n');
    expect(prompt).toContain('### Selection 2: base:src/a.ts:10 (base ');
    expect(prompt).toContain('10    return parts[0];');
    expect(prompt).toContain('### Selection 3: logo.png (head ');
    expect(prompt).toContain('[beuve: binary — not shown]');
    expect(prompt).toContain(
      'Why does «selection 1: src/a.ts:9-11» differ from «selection 2: base:src/a.ts:10»?',
    );
    expect(prompt).toContain('[beuve: the question is about selections 1-3');
    expect(built.system).toContain('Selected by the reviewer');
    expect(built.report.truncatedSelections).toBe(0);
  });

  test('gives selections the budget before the diff and truncates a large one, saying so', ({
    expect,
  }) => {
    const tight: ChatPromptBudget = {
      ...budget(),
      maxChars: 9000,
      maxSelectionChars: 3000,
      maxSelectionFileChars: 1500,
    };
    const built = buildChatPrompt(
      createChatQuestion({
        files: [bigFile('src/huge.ts', 10, 80)],
        selections: [
          {
            kind: 'lines',
            path: 'src/huge.ts',
            side: 'head',
            sha: head,
            startLine: 1,
            endLine: 300,
            totalLines: 300,
            isWholeFile: true,
            lines: lines(1, 300),
          },
          {
            kind: 'lines',
            path: 'src/b.ts',
            side: 'head',
            sha: head,
            startLine: 1,
            endLine: 2,
            totalLines: 3,
            isWholeFile: false,
            lines: lines(1, 2),
          },
        ],
      }),
      tight,
    );
    expect(built.report.truncatedSelections).toBe(1);
    expect(built.prompt).toMatch(
      /\[beuve: selection 1 truncated for size: lines 1-\d+ of 1-300 shown; Read src\/huge\.ts for the rest\]/u,
    );
    expect(built.prompt).toContain('### Selection 2: src/b.ts:1-2');
    expect(built.prompt).toContain('const v2 = 1;');
    expect(built.report.chars).toBeLessThanOrEqual(tight.maxChars);
    expect(built.report.truncatedFiles.length + built.report.omittedFiles.length).toBe(1);
  });

  test('sends the summary instead of the compacted turns, and the turns after it with their mentions', ({
    expect,
  }) => {
    const history: ChatTurn[] = [
      {
        role: 'user',
        content: 'And [[@1]]?',
        mentions: [{ path: 'src/b.ts', side: 'head', startLine: 2, endLine: 2, sha: head }],
      },
      { role: 'assistant', content: 'It returns one.' },
    ];
    const { prompt } = buildChatPrompt(
      createChatQuestion({ summary: '**Asked**\n- why parse trims', history }),
      budget(),
    );
    const summaryAt = prompt.indexOf('## Summary of the conversation so far');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(summaryAt).toBeLessThan(prompt.indexOf('## Earlier in this conversation'));
    expect(prompt).toContain('- why parse trims');
    expect(prompt).toContain('And «selection 1: src/b.ts:2»?');
    expect(prompt).toContain('[beuve: selection 1 was src/b.ts:2]');
  });
});

function lines(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    return `const v${String(from + index)} = ${String(index)};`;
  });
}

function budget(): ChatPromptBudget {
  return defaultChatPromptBudget;
}
