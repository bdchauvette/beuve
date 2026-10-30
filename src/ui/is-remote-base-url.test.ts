import { describe } from 'vitest';

import { isRemoteBaseUrl } from './is-remote-base-url.ts';
import { test } from './testing/test.ts';

describe('isRemoteBaseUrl', () => {
  test.for([
    ['http://localhost:11434/v1', false],
    ['http://127.0.0.1:8080/v1', false],
    ['http://[::1]:8080/v1', false],
    ['http://ollama.localhost/v1', false],
    ['https://api.example.com/v1', true],
    ['http://192.168.1.4:11434/v1', true],
    ['not a url', true],
  ] as const)('%s is remote: %s', ([url, expected], { expect }) => {
    expect(isRemoteBaseUrl(url)).toBe(expected);
  });
});
