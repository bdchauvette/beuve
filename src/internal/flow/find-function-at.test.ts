import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { ecmascriptFlowRules } from './ecmascript-flow-rules.ts';
import { findFunctionAt } from './find-function-at.ts';
import { parseTestSource } from './testing/parse-test-source.ts';

function source(): string {
  return `
class Box {
  method(): number {
    const inner = () => {
      return 1;
    };
    return inner();
  }
}

const top = 1;
function outer() {
  return 2;
}`.trim();
}

describe('findFunctionAt', () => {
  test('finds the innermost enclosing function', async ({ expect }) => {
    const root = await parseTestSource(source());
    expect(findFunctionAt(root, 5, ecmascriptFlowRules)?.type).toBe('arrow_function');
    expect(findFunctionAt(root, 7, ecmascriptFlowRules)?.type).toBe('method_definition');
    expect(findFunctionAt(root, 12, ecmascriptFlowRules)?.text).toContain('return 2');
  });

  test('returns undefined outside any function', async ({ expect }) => {
    const root = await parseTestSource(source());
    expect(findFunctionAt(root, 10, ecmascriptFlowRules)).toBeUndefined();
    expect(findFunctionAt(root, 1, ecmascriptFlowRules)).toBeUndefined();
  });
});
