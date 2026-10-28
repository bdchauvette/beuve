import type { ImpactView } from '#contract/ipc-contract.ts';

/** A row decoration's text lane, as `@pierre/trees` renders it. */
export interface TreeDecoration {
  readonly text: string;
  readonly title: string;
}

/**
 * ImpactGate on the radar tree (ADR 0026): each changed file and each package holding one gets
 * the highest head percentile among its changed functions (`p96`), plus its finding count when
 * functions exceed the cognitive limit (`p96 ▲2`). Nothing before the impact check has answered,
 * and nothing for files it skipped or where no function changed.
 */
export function planTreeDecorations(
  impact: ImpactView | undefined,
  packageOf: ReadonlyMap<string, string>,
): Map<string, TreeDecoration> {
  const decorations = new Map<string, TreeDecoration>();
  if (impact === undefined) {
    return decorations;
  }
  const perFile = new Map<string, Tally>();
  for (const file of impact.files) {
    if (file.status !== 'analyzed') {
      continue;
    }
    const percentiles = file.functions
      .filter((fn) => fn.inDiff && fn.change !== 'removed' && fn.change !== 'unchanged')
      .map((fn) => ('percentile' in fn ? fn.percentile : 0));
    if (percentiles.length > 0) {
      perFile.set(file.path, { percentile: Math.max(...percentiles), findings: 0 });
    }
  }
  for (const finding of impact.findings) {
    const tally = perFile.get(finding.path) ?? { percentile: finding.percentile, findings: 0 };
    perFile.set(finding.path, {
      percentile: Math.max(tally.percentile, finding.percentile),
      findings: tally.findings + 1,
    });
  }
  const perPackage = new Map<string, Tally>();
  for (const [path, tally] of perFile) {
    decorations.set(path, decorate(tally, 'this file', impact.cognitiveMax));
    const root = packageOf.get(path);
    if (root === undefined || root === '') {
      continue;
    }
    const sum = perPackage.get(root) ?? { percentile: 0, findings: 0 };
    perPackage.set(root, {
      percentile: Math.max(sum.percentile, tally.percentile),
      findings: sum.findings + tally.findings,
    });
  }
  for (const [root, tally] of perPackage) {
    decorations.set(root, decorate(tally, 'this package', impact.cognitiveMax));
  }
  return decorations;
}

interface Tally {
  readonly percentile: number;
  readonly findings: number;
}

function decorate(tally: Tally, scope: string, cognitiveMax: number): TreeDecoration {
  const percentile = Math.round(tally.percentile);
  const findings =
    tally.findings === 0
      ? ''
      : `; ${String(tally.findings)} ${tally.findings === 1 ? 'function' : 'functions'} over cognitive ${String(cognitiveMax)}`;
  return {
    text:
      tally.findings === 0
        ? `p${String(percentile)}`
        : `p${String(percentile)} ▲${String(tally.findings)}`,
    title: `ImpactGate: the most complex changed function in ${scope} ranks at percentile ${String(percentile)}${findings}`,
  };
}
