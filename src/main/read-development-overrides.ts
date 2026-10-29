import { parseDevApiBase } from './github/parse-dev-api-base.ts';

/** The environment variables that exist only to drive an unpackaged app against fakes. */
const developmentOverrideVariables = ['BEUVE_GITHUB_API_URL', 'BEUVE_EDITOR_LAUNCH_LOG'] as const;

export interface DevelopmentOverrides {
  /** A loopback fake GitHub API root (ADR 0040). */
  readonly githubApiBase?: URL;
  /** A file that records editor launches instead of starting an editor (ADR 0033). */
  readonly editorLaunchLog?: string;
  /** Override variables that were set but not applied, because the app is packaged. */
  readonly ignored: readonly string[];
}

/**
 * The development-only overrides main applies (ADR 0040, ADR 0048): none at all when the app is
 * packaged, whatever the environment says; the variables found are listed in `ignored` so main can
 * log them. User-facing variables (`BEUVE_CLAUDE_PATH`, `BEUVE_GH_PATH`, `BEUVE_MCP_PORT`,
 * `BEUVE_LOG_LEVEL`) are not overrides and are read elsewhere. Pure.
 */
export function readDevelopmentOverrides(
  isPackaged: boolean,
  env: Readonly<Record<string, string | undefined>>,
): DevelopmentOverrides {
  if (isPackaged) {
    return { ignored: developmentOverrideVariables.filter((name) => env[name] !== undefined) };
  }
  const githubApiBase = parseDevApiBase(env['BEUVE_GITHUB_API_URL']);
  const editorLaunchLog = env['BEUVE_EDITOR_LAUNCH_LOG'];
  return {
    ...(githubApiBase !== undefined && { githubApiBase }),
    ...(editorLaunchLog !== undefined && editorLaunchLog !== '' && { editorLaunchLog }),
    ignored: [],
  };
}
