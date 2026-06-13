/**
 * @kolu/surface-app/vite — the commit, resolved once and injected into the SHELL.
 *
 * Add `surfaceApp()` to a Vite app's `plugins` and the resolved commit is
 * published on `window.__SURFACE_APP_COMMIT__` by an inline script in
 * `index.html` — read it with `shellCommit()` from
 * `@kolu/surface-app/lifecycle`. The commit rides the `no-store` shell, NEVER
 * a bundler `define`: a define bakes it into a content-hashed `/assets/*`
 * file, and a post-build stamp (kolu's Nix `koluStamped`) then rewrites the
 * bytes of a file whose name — and so whose year-long `immutable` cache
 * entry — doesn't change, pinning every returning browser on the old stamp
 * and looping the update prompt forever (kolu#1319).
 *
 * This module is the package's one Node-loaded entry: a Vite config (and kolu's
 * own `vite.config.ts`) imports it through Node's ESM loader, not a bundler.
 * Node ESM cannot resolve extensionless relative `.ts` imports, so this file is
 * deliberately self-contained — it carries `resolveCommit` itself rather than
 * importing it (and writes the `__SURFACE_APP_COMMIT__` global name as a
 * literal; `vite.test.ts` pins it to `SHELL_COMMIT_GLOBAL`) — which lets the
 * rest of the package stay extensionless (like `@kolu/surface`) and frees
 * consumers from needing `allowImportingTsExtensions`. `resolveCommit` LIVES
 * here as the one copy: the server entry (`buildInfoServer` in `./server`)
 * imports it from `/vite` rather than carrying its own — so there is a single
 * source of truth for the commit, and no one should duplicate the resolver.
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

/** The HTML tag descriptor Vite's `transformIndexHtml` accepts — structurally
 *  a `HtmlTagDescriptor`, without taking a dependency on `vite`'s types. */
interface HtmlTagLike {
  tag: string;
  children: string;
  injectTo: "head-prepend";
}

/** A minimal Vite plugin shape — structurally a `Plugin`, without taking a
 *  dependency on `vite`'s types in this package. */
interface VitePluginLike {
  name: string;
  transformIndexHtml(): HtmlTagLike[];
}

export function surfaceApp(
  options: SurfaceAppPluginOptions = {},
): VitePluginLike {
  const commit = options.commit ?? resolveCommit(options.commitEnvVar);
  return {
    name: "surface-app",
    // Publish the commit on the shell global (`head-prepend`, so it's set
    // before the module bundle reads it) — never a `define` into the bundle
    // (kolu#1319; see the module header). The global name is a literal here
    // (self-contained module); `vite.test.ts` pins it to `SHELL_COMMIT_GLOBAL`.
    // `JSON.stringify` + `<`-escape so no commit string can close the script.
    transformIndexHtml() {
      const literal = JSON.stringify(commit).replace(/</g, "\\u003c");
      return [
        {
          tag: "script",
          children: `window.__SURFACE_APP_COMMIT__=${literal}`,
          injectTo: "head-prepend",
        },
      ];
    },
  };
}
