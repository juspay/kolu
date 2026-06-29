/**
 * The two-mode supervised-daemon launcher resolver, shared by the kaval and pulam
 * drivers — the ONE place that knows the `node --import <tsx loader> bin.ts`
 * incantation, so a fiddly tsx-loader resolution isn't kept in sync in two spots.
 *
 *   - **Production / nix** — `<binEnvVar>` points at the built wrapper
 *     (`${pkg}/bin/<pkg>`, itself `node --import <tsx loader> bin.ts`). Spawn it
 *     directly with the daemon args.
 *   - **Dev / e2e** — no wrapper, so reproduce its launcher from source:
 *     `node --import <tsx loader> <bin.ts>`. The tsx loader is resolved through
 *     the package (not a hoisted `.bin/tsx`), so it works under `test-quick`.
 *
 * The dev-flag filter is by construction: the daemon's argv is built fresh here,
 * so kolu's own `process.execArgv` (an `--inspect`, a heap-snapshot flag) never
 * propagates. Each driver supplies only its genuinely-divergent VALUES — the
 * env-var name, the from-source `bin.ts` path (resolved against the CALLER's
 * `import.meta.url`, since the relative path is the caller's), and the daemon
 * args; the resolution mechanism lives here.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function resolveDaemonLaunch(opts: {
  /** Env var holding the built wrapper path (e.g. `KOLU_KAVAL_BIN`). */
  binEnvVar: string;
  /** Absolute path to the package's `src/bin.ts` — the from-source fallback. The
   *  CALLER resolves it (`fileURLToPath(new URL("../../../<pkg>/src/bin.ts",
   *  import.meta.url))`) so the relative path is anchored at the caller. */
  sourceBinPath: string;
  /** The daemon's own args (e.g. `["--socket", path]`), appended in both modes. */
  daemonArgs: string[];
}): { binPath: string; args: string[] } {
  const wrapper = process.env[opts.binEnvVar];
  if (wrapper) return { binPath: wrapper, args: opts.daemonArgs };

  // Dev/e2e: no nix wrapper — reproduce its launcher from source. The loader is
  // resolved via the package (the hoisted `tsx`), not a `.bin` symlink, so the
  // spawn doesn't depend on a hoisted bin.
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, opts.sourceBinPath, ...opts.daemonArgs],
  };
}
