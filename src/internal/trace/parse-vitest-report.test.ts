import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { parseVitestReport } from './parse-vitest-report.ts';

describe('parseVitestReport', () => {
  test('reads test results and files that failed to load', ({ expect }) => {
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
    expect(parseVitestReport(JSON.stringify(report), '/w')).toStrictEqual([
      {
        file: 'src/a.test.ts',
        titles: ['suite', 'works'],
        status: 'passed',
        duration: Temporal.Duration.from({ milliseconds: 3 }),
        failure: undefined,
      },
      {
        file: 'src/a.test.ts',
        titles: ['suite', 'breaks'],
        status: 'failed',
        duration: undefined,
        failure: 'boom',
      },
      {
        file: 'src/a.test.ts',
        titles: ['later'],
        status: 'skipped',
        duration: undefined,
        failure: undefined,
      },
      {
        file: 'src/b.test.ts',
        titles: [],
        status: 'failed',
        duration: undefined,
        failure: 'SyntaxError',
      },
    ]);
  });

  test('refuses text that is not a report', ({ expect }) => {
    expect(parseVitestReport('', '/w')).toBeUndefined();
    expect(parseVitestReport('{}', '/w')).toBeUndefined();
  });
});
