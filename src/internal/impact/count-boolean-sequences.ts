import type { ImpactNode } from './impact-node.ts';
import type { LanguageRules } from './language-rules.ts';

/**
 * Cognitive complexity of a boolean expression rooted at `root`: +1 for each run of like operators
 * in source order, through parentheses (`a && b && c` is 1, `a && b || c && d` is 3, `a && (b || c)`
 * is 2). Operands that aren't boolean operators end the expression; their contents count on their own.
 */
export function countBooleanSequences(root: ImpactNode, rules: LanguageRules): number {
  let runs = 0;
  let previous: string | undefined;
  const stack: (ImpactNode | string)[] = [root];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (typeof item === 'string') {
      if (item !== previous) {
        runs += 1;
      }
      previous = item;
      continue;
    }
    const operatorNode = logicalOperator(item, rules);
    if (operatorNode === undefined && !rules.transparent.includes(item.type)) {
      continue;
    }
    for (let index = item.children.length - 1; index >= 0; index -= 1) {
      const child = item.children[index];
      if (child === undefined) {
        continue;
      }
      if (child.id === operatorNode?.id) {
        stack.push(child.type);
      } else {
        stack.push(child);
      }
    }
  }
  return runs;
}

function logicalOperator(node: ImpactNode, rules: LanguageRules): ImpactNode | undefined {
  const rule = rules.constructs[node.type];
  if (rule?.kind !== 'logical') {
    return undefined;
  }
  const operator = node.childForFieldName(rule.operatorField);
  if (operator !== null && rule.operators.includes(operator.type)) {
    return operator;
  }
  return undefined;
}
