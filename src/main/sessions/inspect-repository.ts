import type {
  InspectRepositoryRequest,
  IpcError,
  RepositoryInspectionView,
} from '#contract/ipc-contract.ts';
import { inspectBranches } from '#internal/git/inspect-branches.ts';
import { openRepository } from '#internal/git/open-repository.ts';
import { ok } from '#pkg/result/ok.ts';
import type { Result } from '#pkg/result/result.ts';

import { gitFailure } from './git-failure.ts';
import type { SessionContext } from './session-context.ts';

/**
 * The repository containing a picked folder, with its branches and default refs, so the open
 * flow can suggest a base and a head before a local session exists. Reads only.
 */
export async function inspectRepository(
  context: SessionContext,
  request: InspectRepositoryRequest,
): Promise<Result<RepositoryInspectionView, IpcError>> {
  const repository = await openRepository(request.path, context.git);
  if (!repository.ok) {
    return gitFailure(context.logger, repository.error);
  }
  const inspected = await inspectBranches(repository.value);
  if (!inspected.ok) {
    return gitFailure(context.logger, inspected.error);
  }
  const { current, defaultBase, branches } = inspected.value;
  return ok({
    root: repository.value.root,
    ...(current !== undefined && { currentBranch: current }),
    ...(defaultBase !== undefined && { defaultBase }),
    branches,
  });
}
