/**
 * @kolu/surface-app/vite — the commit, resolved once and injected.
 *
 * Add `surfaceApp()` to a Vite app's `plugins` and the client constant
 * `__SURFACE_APP_COMMIT__` is defined from the resolved commit — no per-app
 * `define`, no sha literal. Pair with the shipped type at
 * `@kolu/surface-app/client` (a one-line `/// <reference>` in the app), so the
 * declaration lives in the library, not in every consumer.
 *
 * This module is the package's one Node-loaded entry: a Vite config (and kolu's
 * own `vite.config.ts`) imports it through Node's ESM loader, not a bundler.
 * Node ESM cannot resolve extensionless relative `.ts` imports, so this file is
 * deliberately self-contained — it carries `resolveCommit` itself rather than
 * importing it — which lets the rest of the package stay extensionless (like
 * `@kolu/surface`) and frees consumers from needing `allowImportingTsExtensions`.
 * `resolveCommit` LIVES here as the one copy: the server entry
 * (`buildInfoServer` in `./server`) imports it from `/vite` rather than carrying
 * its own — so there is a single source of truth for the commit, and no one
 * should duplicate the resolver.
 */

import { execSync } from "node:child_process";

/** The default env var the commit is read from. */
export const DEFAULT_COMMIT_ENV_VAR = "SURFACE_APP_COMMIT";

/**
 * Resolve the build commit, once, from one source of truth: `envVar` →
 * `git rev-parse --short HEAD` → `"dev"`. Override `envVar` (default
 * `SURFACE_APP_COMMIT`) when the build system uses another name (e.g. kolu's
 * `KOLU_COMMIT_HASH`). `"dev"` is treated as never-stale by `clientIsStale`, so
 * dev builds don't false-positive as skewed. Node-only (uses `git`); consumed
 * by this `/vite` plugin (client define) and by `buildInfoServer` (server cell).
 */
export function resolveCommit(envVar = DEFAULT_COMMIT_ENV_VAR): string {
  const fromEnv = process.env[envVar]?.trim();
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

export interface SurfaceAppPluginOptions {
  /** Override the resolved commit (rarely needed; defaults to `resolveCommit()`). */
  commit?: string;
  /** The env var the commit is read from (default `SURFACE_APP_COMMIT`). Set it
   *  when your build system names the var otherwise (e.g. kolu's
   *  `KOLU_COMMIT_HASH`). Ignored if `commit` is given. */
  commitEnvVar?: string;
}

/** A minimal Vite plugin shape — structurally a `Plugin`, without taking a
 *  dependency on `vite`'s types in this package. */
interface VitePluginLike {
  name: string;
  config(): { define: Record<string, string> };
}

export function surfaceApp(
  options: SurfaceAppPluginOptions = {},
): VitePluginLike {
  const commit = options.commit ?? resolveCommit(options.commitEnvVar);
  return {
    name: "surface-app",
    config() {
      return { define: { __SURFACE_APP_COMMIT__: JSON.stringify(commit) } };
    },
  };
}
