import { z } from 'zod';

import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';

import type { RepositoryDetails } from './branch-ref.ts';
import { decodeWith } from './decode-with.ts';
import type { GithubCallOptions, GithubClient } from './github-client.ts';
import type { GithubError } from './github-error.ts';
import { githubPath } from './github-path.ts';

const repositorySchema = z
  .object({
    name: z.string(),
    owner: z.object({ login: z.string() }),
    default_branch: z.string(),
    html_url: z.string(),
  })
  .transform((raw): RepositoryDetails => {
    return {
      owner: raw.owner.login,
      repo: raw.name,
      defaultBranch: raw.default_branch,
      htmlUrl: raw.html_url,
    };
  });

/** The repository a branch session follows, for its canonical name and default branch. */
export interface RepositoryName {
  readonly owner: string;
  readonly repo: string;
}

/** `GET /repos/{owner}/{repo}`: its current name and default branch (ADR 0112). */
export async function getRepository<E>(
  client: GithubClient<E>,
  repository: RepositoryName,
  options: GithubCallOptions = {},
): Promise<Result<RepositoryDetails, GithubError<E>>> {
  const response = await client.send({
    method: 'GET',
    path: githubPath`/repos/${repository.owner}/${repository.repo}`,
    ...options,
  });
  if (!response.ok) {
    return response;
  }
  const decoded = decodeWith(repositorySchema, response.value.body);
  if (decoded.ok) {
    return ok(decoded.value);
  }
  return err({ kind: 'unexpected-shape', reason: decoded.error });
}
