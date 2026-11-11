import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { openLogFile } from './open-log-file.ts';

describe('openLogFile', () => {
  test('writes this run’s lines after moving the last run’s file aside', ({ expect, tempDir }) => {
    const logs = path.join(tempDir, 'logs');
    const options = {
      path: path.join(logs, 'main.log'),
      previousPath: path.join(logs, 'main.previous.log'),
    };
    const first = openLogFile(options);
    first('{"message":"one"}');
    const second = openLogFile(options);
    second('{"message":"two"}');
    second('{"message":"three"}');
    expect(readFileSync(options.previousPath, 'utf8')).toBe('{"message":"one"}\n');
    expect(readFileSync(options.path, 'utf8')).toBe('{"message":"two"}\n{"message":"three"}\n');
    expect(statSync(options.path).mode & 0o777).toBe(0o600);
    expect(statSync(logs).mode & 0o777).toBe(0o700);
  });

  test('drops lines it cannot write instead of throwing', ({ expect, tempDir }) => {
    const blocker = path.join(tempDir, 'not-a-directory');
    writeFileSync(blocker, '');
    const sink = openLogFile({
      path: path.join(blocker, 'main.log'),
      previousPath: path.join(blocker, 'main.previous.log'),
    });
    expect(() => {
      sink('{"message":"lost"}');
    }).not.toThrow();
  });
});
