import { describe } from 'vitest';

import { isLoopbackUrl } from './is-loopback-url.ts';
import { test } from '#testing/test.ts';

describe('isLoopbackUrl', () => {
  test.for([
    ['http://localhost:11434/v1', true],
    ['http://LOCALHOST/v1', true],
    ['http://ollama.localhost/v1', true],
    ['http://127.0.0.1:8080/v1', true],
    ['http://127.1.2.3/v1', true],
    ['http://[::1]:1234/v1', true],
    ['https://api.example.com/v1', false],
    ['http://192.168.1.10:11434/v1', false],
    ['https://localhost.example.com/v1', false],
    ['http://10.0.0.1/v1', false],
    ['not a url', false],
  ] as const)('%s is loopback: %s', ([url, expected], { expect }) => {
    expect(isLoopbackUrl(url)).toBe(expected);
  });
});
