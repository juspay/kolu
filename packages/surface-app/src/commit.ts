/**
 * @kolu/surface-app — resolve the build commit, once, from one source of truth.
 *
 * Node-only (uses `git`); imported by the `/vite` plugin (client define) and by
 * `buildInfoServer` (the server cell). An app never writes a sha: it's the
 * `SURFACE_APP_COMMIT` env, else `git rev-parse --short HEAD`, else `"dev"` —
 * which `clientIsStale` already treats as never-stale, so dev builds don't
 * false-positive as skewed.
 */

import { execSync } from "node:child_process";

export function resolveCommit(): string {
  const fromEnv = process.env.SURFACE_APP_COMMIT?.trim();
  if (fromEnv) return fromEnv;
  try {
    const rev = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return rev || "dev";
  } catch {
    return "dev";
  }
}
