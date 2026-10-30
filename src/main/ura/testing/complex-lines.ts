/** Mirrors `decide`'s nesting so ImpactGate flags it (cognitive complexity over 15). */
export function complexLines(): string[] {
  return [
    'export function decide(a: number, b: number, c: readonly number[]): number {',
    '  if (a > 0) {',
    '    if (b > 0) {',
    '      for (const x of c) {',
    '        if (x > a) {',
    '          if (x > b && a !== b) {',
    '            return x;',
    '          } else if (x < 0) {',
    '            continue;',
    '          }',
    '        } else {',
    '          while (x > 10) {',
    '            break;',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  return 0;',
    '}',
  ];
}
