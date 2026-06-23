/**
 * pulam-web's port constants + the strict port parser.
 *
 * Split out of `config.ts` for ONE structural reason: `vite.config.ts` needs the
 * port defaults (to compute its dev-proxy target), and Vite loads its config
 * through Node's NATIVE ESM resolver. `config.ts` imports `@kolu/surface-nix-host`
 * (for `resolveSystem` / `ResolveDrvError`), whose barrel uses extensionless
 * relative imports (`export … from "./arch"`) that the workspace's bundler-mode
 * `tsc`/`vitest` resolve but native ESM does NOT — so a `vite.config.ts` that
 * reached the drv-resolver transitively would fail the client build with
 * `ERR_MODULE_NOT_FOUND` (and `nix run .#pulam-web` would never build its
 * bundle). These helpers depend on nothing but the standard library, so Vite
 * imports them here directly and the build stays clean. `config.ts` re-exports
 * them, so server-side consumers still read everything from one module.
 */

/** The HTTP+WebSocket port. `4800` is pulam-web's default (the `48` echoes the
 *  R4.8 epic). Override with `PULAM_WEB_PORT`. */
export const DEFAULT_PORT = 4800;

/** The dev client (Vite) default port. `5800` pairs with `DEFAULT_PORT`'s `48`.
 *  Override with `PULAM_WEB_CLIENT_PORT`. */
export const DEFAULT_CLIENT_PORT = 5800;

/**
 * Parse a port env var, using `fallback` ONLY when the var is unset/empty.
 *
 * Fail-fast, no silent fallback: a present-but-malformed value (`abc`, `12.5`,
 * `99999`, or an explicit `0` — which would bind an arbitrary OS-assigned port,
 * never what a config author means) THROWS, naming the var, rather than quietly
 * collapsing to the default the way `Number(env) || fallback` does (the F6 bug:
 * `Number("abc") || 4800` and `Number("0") || 4800` both silently yield 4800).
 * A valid integer in `1..65535` is returned as-is.
 */
export function parsePort(
  varName: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  // Reject anything that isn't a plain non-negative integer literal up front —
  // `Number` would accept "12.5", "0x10", "1e3", " 80 " and leading/trailing
  // junk via coercion, none of which is a port a config author typed on purpose.
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `${varName}: invalid port ${JSON.stringify(raw)} — must be an integer in 1..65535.`,
    );
  }
  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${varName}: port ${port} out of range — must be an integer in 1..65535 (0 is rejected: it would bind an arbitrary OS-assigned port).`,
    );
  }
  return port;
}
