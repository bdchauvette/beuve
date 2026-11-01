import path from 'node:path';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { EcosystemRow, ToolId } from './dependency-ecosystem.ts';
import type { InstallUnit } from './detect-install-units.ts';
import { ecosystemRows } from './ecosystem-rows.ts';
import type { InstallConfig } from './install-config.ts';
import { unitsToInstall } from './units-to-install.ts';

/** A found executable for a row: which candidate, how to start it, and what it reported. */
export interface ResolvedTool {
  /** The candidate's `executable` (`rv` or `bundle`). */
  readonly executable: string;
  /** What starts it: `[node, corepack.js, 'pnpm']`, or `['/opt/homebrew/bin/uv']`. */
  readonly command: readonly string[];
  /** `--version`'s first line, when it answered. */
  readonly version: string | undefined;
  /** `PATH` and the like for this tool (toolchain discovery, Settings overrides). */
  readonly env: Readonly<Record<string, string>>;
}

/** One process of an install, in order. */
export interface PlannedStep {
  /** What the log and status call it: `pnpm in web/`, `.beuve/hooks/install`. */
  readonly label: string;
  /** Relative to the checkout; `''` is its top level. */
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The tool a step uses and the version it reported, recorded with the install. */
export interface ToolUse {
  readonly tool: string;
  readonly version: string | undefined;
}

export interface InstallPlan {
  readonly steps: readonly PlannedStep[];
  readonly tools: readonly ToolUse[];
}

/** A row the reviewed tree needs whose tool wasn't found, and how to get it. */
export interface MissingTool {
  readonly tool: ToolId;
  readonly label: string;
  readonly executables: readonly string[];
  readonly fix: string;
}

/** What an install is planned from. */
export interface InstallPlanInput {
  readonly units: readonly InstallUnit[];
  readonly config: InstallConfig;
  /** The absolute path of the checkout's `.beuve/hooks/install`, when it is an executable file. */
  readonly hook: string | undefined;
  /** The found tool per row; a row without one is missing. */
  readonly tools: ReadonlyMap<ToolId, ResolvedTool>;
  /** `<userData>/deps/cache`. */
  readonly cacheRoot: string;
  /** Variables every step gets (the hook's documented ones among them). */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Orders an install (ADR 0089, 0092): the detected units the configuration doesn't skip (none
 * when the hook replaces them), top level first, each with its row's frozen install; then the
 * configured steps; then `.beuve/hooks/install`. Refuses, listing every row whose tool is
 * missing, rather than installing part of the tree.
 */
export function planInstall(input: InstallPlanInput): Result<InstallPlan, readonly MissingTool[]> {
  const { config, tools } = input;
  const units = unitsToInstall(input.units, config);
  const missing: MissingTool[] = [];
  const steps: PlannedStep[] = [];
  const uses = new Map<string, ToolUse>();
  for (const unit of units) {
    const row = rowOf(unit.tool);
    const tool = tools.get(unit.tool);
    const candidate = row.candidates.find((entry) => entry.executable === tool?.executable);
    if (tool === undefined || candidate === undefined) {
      if (missing.every((entry) => entry.tool !== row.tool)) {
        missing.push({
          tool: row.tool,
          label: row.label,
          executables: row.candidates.map((entry) => entry.executable),
          fix: row.fix,
        });
      }
      continue;
    }
    const context = { lockfiles: unit.lockfiles, cache: path.join(input.cacheRoot, row.cache) };
    const env = { ...input.env, ...tool.env, ...candidate.env(context) };
    let where = 'the top level';
    if (unit.directory !== '') {
      where = `${unit.directory}/`;
    }
    for (const args of candidate.steps(context)) {
      steps.push({
        label: `${row.label} in ${where}`,
        cwd: unit.directory,
        argv: [...tool.command, ...args],
        env,
      });
    }
    uses.set(tool.executable, { tool: tool.executable, version: tool.version });
  }
  if (missing.length > 0) {
    return err(missing);
  }
  const configured = config.steps ?? [];
  for (const step of configured) {
    steps.push({
      label: `.beuve step: ${step.run.join(' ')}`,
      cwd: step.cwd,
      argv: step.run,
      env: { ...input.env, ...step.env },
    });
  }
  if (input.hook !== undefined) {
    steps.push({ label: '.beuve/hooks/install', cwd: '', argv: [input.hook], env: input.env });
  }
  return ok({ steps, tools: uses.values().toArray() });
}

function rowOf(tool: ToolId): EcosystemRow {
  const row = ecosystemRows.find((candidate) => candidate.tool === tool);
  if (row === undefined) {
    throw new Error(`no ecosystem row for ${tool}`);
  }
  return row;
}
