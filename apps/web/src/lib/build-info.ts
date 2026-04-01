export const BUILD_MARKER = 'bug009-active-frontier-2026-03-30-r2';

export interface BuildInfo {
  readonly marker: string;
  readonly commit_sha: string | null;
  readonly branch: string | null;
  readonly vercel_env: string | null;
}

export function getBuildInfo(): BuildInfo {
  return {
    marker: BUILD_MARKER,
    commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    vercel_env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
  };
}
