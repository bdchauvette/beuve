import { describe, expect, it } from 'vitest';

import { ecmascriptFlowRules } from './ecmascript-flow-rules.ts';
import { findFunctionAt } from './find-function-at.ts';
import { parseTestSource } from './testing/parse-test-source.ts';

const source = `
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

describe('findFunctionAt', () => {
  it('finds the innermost enclosing function', async () => {
    const root = await parseTestSource(source);
    expect(findFunctionAt(root, 5, ecmascriptFlowRules)?.type).toBe('arrow_function');
    expect(findFunctionAt(root, 7, ecmascriptFlowRules)?.type).toBe('method_definition');
    expect(findFunctionAt(root, 12, ecmascriptFlowRules)?.text).toContain('return 2');
  });

  it('returns undefined outside any function', async () => {
    const root = await parseTestSource(source);
    expect(findFunctionAt(root, 10, ecmascriptFlowRules)).toBeUndefined();
    expect(findFunctionAt(root, 1, ecmascriptFlowRules)).toBeUndefined();
  });
});
