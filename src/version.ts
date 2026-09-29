const DEV_VERSION = 'dev';

/**
 * The release version comes from the `APP_VERSION` environment variable, which
 * the container build sets from the git tag. Anything else — a local run, a
 * test — reports `dev` rather than a stale package.json number.
 */
export function resolveAppVersion(raw: string | undefined): string {
  const version = raw?.trim();
  return version ? version : DEV_VERSION;
}

export const APP_VERSION = resolveAppVersion(process.env.APP_VERSION);
