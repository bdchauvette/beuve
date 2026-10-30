import { describe } from 'vitest';

import { test } from './testing/test.ts';

import type { FileAttributesView } from '#contract/ipc-contract.ts';

import { planDiffDeferrals } from './plan-diff-deferrals.ts';
import { createDiffFileView } from './testing/create-diff-file-view.ts';

function small(): string[] {
  return ['-a', '+b'];
}

function added(count: number): string[] {
  return '+x\n'.repeat(count).split('\n').slice(0, count);
}

function attributes(lists: Partial<FileAttributesView>): FileAttributesView {
  return { sessionId: 's', headSha: 'h', generated: [], notGenerated: [], noDiff: [], ...lists };
}

describe('planDiffDeferrals', () => {
  test('defers lockfiles by name in any directory, and nothing else small', ({ expect }) => {
    const files = [
      'package-lock.json',
      'web/pnpm-lock.yaml',
      'yarn.lock',
      'crates/x/Cargo.lock',
      'go.sum',
      'poetry.lock',
      'Gemfile.lock',
      'composer.lock',
      'src/lock.ts',
      'docs/yarn.lock.md',
    ].map((path) => createDiffFileView(path, small()));
    const deferrals = planDiffDeferrals(files, undefined);
    expect(Array.from(deferrals, ([path]) => path)).toStrictEqual(
      files.slice(0, 8).map((file) => file.path),
    );
    expect(deferrals.get('go.sum')).toMatchObject({
      reason: 'lockfile',
      rows: 6,
      isGeneratedOnly: false,
    });
  });

  test('defers a patch over the line or character limit', ({ expect }) => {
    const limits = { maxRows: 10, maxCharacters: 400 };
    const long = createDiffFileView('src/long.ts', added(7));
    const wide = createDiffFileView('src/wide.ts', [`+${'x'.repeat(400)}`]);
    const fits = createDiffFileView('src/fits.ts', added(6));
    const deferrals = planDiffDeferrals([long, wide, fits], undefined, limits);
    expect(deferrals.get('src/long.ts')).toMatchObject({ reason: 'large', rows: 11 });
    expect(deferrals.get('src/wide.ts')?.reason).toBe('large');
    expect(deferrals.has('src/fits.ts')).toBe(false);
  });

  test('marks linguist-generated, -diff and generated-looking names, which the toggle can expand', ({
    expect,
  }) => {
    const files = ['gen/api.ts', 'snap/a.snap', 'dist/app.min.js', 'x/__generated__/y.ts'].map(
      (path) => createDiffFileView(path, small()),
    );
    const deferrals = planDiffDeferrals(
      files,
      attributes({ generated: ['gen/api.ts'], noDiff: ['snap/a.snap'] }),
    );
    expect(deferrals.get('gen/api.ts')).toMatchObject({
      reason: 'generated',
      isGeneratedOnly: true,
    });
    expect(deferrals.get('snap/a.snap')?.reason).toBe('no-diff');
    expect(deferrals.get('dist/app.min.js')?.reason).toBe('generated');
    expect(deferrals.get('x/__generated__/y.ts')?.reason).toBe('generated');
  });

  test('lets linguist-generated=false override the name rules but not the size limit', ({
    expect,
  }) => {
    const lock = createDiffFileView('package-lock.json', small());
    const bundle = createDiffFileView('app.min.js', added(20));
    const deferrals = planDiffDeferrals(
      [lock, bundle],
      attributes({ notGenerated: ['package-lock.json', 'app.min.js'] }),
      { maxRows: 10, maxCharacters: 1e6 },
    );
    expect(deferrals.has('package-lock.json')).toBe(false);
    expect(deferrals.get('app.min.js')?.reason).toBe('large');
  });

  test('keeps a large generated file collapsed when generated files are shown', ({ expect }) => {
    const big = createDiffFileView('gen/big.ts', added(20));
    const deferral = planDiffDeferrals([big], attributes({ generated: ['gen/big.ts'] }), {
      maxRows: 10,
      maxCharacters: 1e6,
    }).get('gen/big.ts');
    expect(deferral).toMatchObject({ reason: 'generated', isGeneratedOnly: false });
  });

  test('never defers a file without hunks', ({ expect }) => {
    const binary = createDiffFileView('yarn.lock', [], 1, { hunks: [], binary: true });
    expect(planDiffDeferrals([binary], undefined).size).toBe(0);
  });
});
