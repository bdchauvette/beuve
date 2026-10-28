import { describe, expect, it } from 'vitest';

import { parseVitestReport } from './parse-vitest-report.ts';

describe('parseVitestReport', () => {
  it('reads test results and files that failed to load', () => {
    const report = {
      testResults: [
        {
          name: '/w/src/a.test.ts',
          status: 'failed',
          assertionResults: [
            {
              ancestorTitles: ['suite'],
              title: 'works',
              status: 'passed',
              duration: 3,
              failureMessages: [],
            },
            {
              ancestorTitles: ['suite'],
              title: 'breaks',
              status: 'failed',
              failureMessages: ['boom'],
            },
            { ancestorTitles: [], title: 'later', status: 'todo' },
          ],
        },
        {
          name: '/w/src/b.test.ts',
          status: 'failed',
          message: 'SyntaxError',
          assertionResults: [],
        },
      ],
    };
    expect(parseVitestReport(JSON.stringify(report), '/w')).toEqual([
      {
        file: 'src/a.test.ts',
        titles: ['suite', 'works'],
        status: 'passed',
        durationMs: 3,
        failure: undefined,
      },
      {
        file: 'src/a.test.ts',
        titles: ['suite', 'breaks'],
        status: 'failed',
        durationMs: undefined,
        failure: 'boom',
      },
      {
        file: 'src/a.test.ts',
        titles: ['later'],
        status: 'skipped',
        durationMs: undefined,
        failure: undefined,
      },
      {
        file: 'src/b.test.ts',
        titles: [],
        status: 'failed',
        durationMs: undefined,
        failure: 'SyntaxError',
      },
    ]);
  });

  it('refuses text that is not a report', () => {
    expect(parseVitestReport('', '/w')).toBeUndefined();
    expect(parseVitestReport('{}', '/w')).toBeUndefined();
  });
});
