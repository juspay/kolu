/**
 * @kolu/surface-app/vite — the commit, resolved once and injected.
 *
 * Add `surfaceApp()` to a Vite app's `plugins` and the client constant
 * `__SURFACE_APP_COMMIT__` is defined from the resolved commit — no per-app
 * `define`, no sha literal. Pair with the shipped type at
 * `@kolu/surface-app/client` (a one-line `/// <reference>` in the app), so the
 * declaration lives in the library, not in every consumer.
 */

import { resolveCommit } from "./commit.ts";

export interface SurfaceAppPluginOptions {
  /** Override the resolved commit (rarely needed; defaults to `resolveCommit()`). */
  commit?: string;
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
  const commit = options.commit ?? resolveCommit();
  return {
    name: "surface-app",
    config() {
      return { define: { __SURFACE_APP_COMMIT__: JSON.stringify(commit) } };
    },
  };
}

export { resolveCommit } from "./commit.ts";
