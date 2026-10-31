/** The two statements a branch of the flow fixture changes. */
export interface FlowSourceEdits {
  /** The loop's `total +=` expression. */
  readonly accumulate: string;
  /** The statement of the switch's `case 'b'`. */
  readonly caseB: string;
}

/** A function with an if/else-if chain, a loop with continue and break, a switch and a try. */
export function flowSource({ accumulate, caseB }: FlowSourceEdits): string[] {
  return [
    'export function process(items: number[], mode: string): number {',
    '  let total = 0;',
    '  if (items.length === 0) {',
    '    return -1;',
    "  } else if (mode === 'fast') {",
    '    total += 1;',
    '  } else {',
    '    total -= 1;',
    '  }',
    '  for (const item of items) {',
    '    if (item < 0) {',
    '      continue;',
    '    }',
    '    if (item > 100) {',
    '      break;',
    '    }',
    `    total += ${accumulate};`,
    '  }',
    '  switch (mode) {',
    "    case 'a':",
    '      total *= 2;',
    '      break;',
    "    case 'b':",
    `      ${caseB};`,
    '      break;',
    '    default:',
    '      total = 0;',
    '  }',
    '  try {',
    '    total = risky(total);',
    '  } catch (error) {',
    '    total = -total;',
    '  } finally {',
    '    cleanup();',
    '  }',
    '  return total;',
    '}',
  ];
}
