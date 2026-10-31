import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import { assessImpact } from './assess-impact.ts';
import { defaultImpactConfig } from './default-impact-config.ts';
import type { ImpactConfig } from './default-impact-config.ts';
import type { SourceMeasurement } from './function-measurement.ts';
import type { ImpactSourceFile, MeasuredFile, ParseSource } from './impact-input.ts';
import { locationOf } from './location-of.ts';
import type { ImpactReport, SkipReason } from './impact-report.ts';
import { measureFunctions } from './measure-functions.ts';
import { rulesByLanguage } from './rules-by-language.ts';

interface MeasuredSide {
  readonly language: string;
  readonly measurement: SourceMeasurement;
}

/**
 * ImpactGate for a set of changed files (ADR 0015): parses both sides of each with `parse`,
 * measures every function while its tree is alive, and assesses the change. Files in languages
 * without rules, or that fail to parse, are reported as skipped rather than failing the check.
 */
export async function runImpactCheck(
  files: readonly ImpactSourceFile[],
  parse: ParseSource,
  config: ImpactConfig = defaultImpactConfig,
): Promise<ImpactReport> {
  const measured = await Promise.all(files.map(async (file) => measureFile(file, parse)));
  return assessImpact(measured, config);
}

async function measureFile(file: ImpactSourceFile, parse: ParseSource): Promise<MeasuredFile> {
  const location = locationOf(file);
  const [base, head] = await Promise.all([
    measureSide(file.previousPath ?? file.path, file.baseText, parse),
    measureSide(file.path, file.headText, parse),
  ]);
  if (!base.ok) {
    return { status: 'skipped', ...location, reason: base.error };
  }
  if (!head.ok) {
    return { status: 'skipped', ...location, reason: head.error };
  }
  const language = head.value?.language ?? base.value?.language;
  if (language === undefined) {
    return { status: 'skipped', ...location, reason: 'no-source' };
  }
  return {
    status: 'measured',
    ...location,
    language,
    base: base.value?.measurement,
    head: head.value?.measurement,
    changedLines: file.changedLines,
  };
}

async function measureSide(
  path: string,
  text: string | undefined,
  parse: ParseSource,
): Promise<Result<MeasuredSide | undefined, SkipReason>> {
  if (text === undefined) {
    return ok(undefined);
  }
  const parsed = await parse({ path, text }, (root, language): MeasuredSide | undefined => {
    const rules = rulesByLanguage[language];
    if (rules === undefined) {
      return undefined;
    }
    return { language, measurement: measureFunctions(root, rules) };
  });
  if (!parsed.ok) {
    return err(skipReasonFrom(parsed.error.kind));
  }
  if (parsed.value === undefined) {
    return err('unsupported-language');
  }
  return ok(parsed.value);
}

function skipReasonFrom(kind: string): SkipReason {
  if (kind === 'unsupported-language' || kind === 'too-large') {
    return kind;
  }
  return 'parse-failed';
}
