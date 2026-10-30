import type { RepositoryTemplate } from '#internal/git/testing/test-repository.ts';

import { createTraceTestProject } from './create-trace-test-project.ts';

/**
 * A Vitest project with a clamp function and a test that hangs: `main` has the base, `feature`
 * (checked out) changes `clamp`, `hang` and `orphan` and adds a note.
 */
export function traceBranchTemplate(): RepositoryTemplate<undefined> {
  return {
    name: 'main-trace: feature branch',
    build: async (repo): Promise<undefined> => {
      createTraceTestProject(repo);
      repo.write('src/math.ts', baseMath());
      repo.write('src/math.test.ts', mathTest());
      repo.write('src/hang.ts', hang(0));
      repo.write('src/hang.test.ts', hangTest());
      repo.write('src/orphan.ts', 'export function orphan(): number {\n  return 1;\n}\n');
      await repo.commit('base');
      await repo.git('switch', '--quiet', '-c', 'feature');
      repo.write('src/math.ts', headMath());
      repo.write('src/hang.ts', hang(1));
      repo.write('src/orphan.ts', 'export function orphan(): number {\n  return 2;\n}\n');
      repo.write('notes.md', 'notes\n');
      await repo.commit('feature');
    },
  };
}

function baseMath(): string {
  return `export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  return value;
}
`;
}

function headMath(): string {
  return `export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}
`;
}

function mathTest(): string {
  return `import { describe, expect, it } from 'vitest';
import { clamp } from './math.ts';

describe('clamp', () => {
  it('caps high values', () => {
    expect(clamp(12, 0, 10)).toBe(10);
  });
  it('keeps values in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
`;
}

function hang(value: number): string {
  return `export function hang(): number {\n  return ${String(value)};\n}\n`;
}

function hangTest(): string {
  return `import { it } from 'vitest';
import { hang } from './hang.ts';

it('hangs', async () => {
  hang();
  await new Promise(() => {});
}, 120_000);
`;
}
