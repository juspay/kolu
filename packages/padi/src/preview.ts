/**
 * `@kolu/padi/preview` — the realpath/symlink-escape guard the iframe
 * binary-preview backing (`padiSurface.procedures.preview.read`) injects into
 * `@kolu/serve-dir`'s `serveFile`.
 *
 * This is a deliberate RE-CREATION of `packages/server`'s
 * `previewRealpathGuard` (`iframePreviewRoute.ts`): that module STAYS in
 * kolu-server (it wraps the Hono preview route, web-shell code that does not
 * relocate), and `@kolu/padi` must never import from `packages/server` (the
 * dependency arrow points OUT). The guard itself is a tiny pure adapter over
 * kolu-git's `assertRealpathUnder`, so reproducing it here — rather than
 * reaching back into the server — keeps the boundary honest. Its behaviour is
 * identical: resolve symlinks and reject anything whose real path escapes the
 * root (a repo-local `leak.html -> /etc/passwd` an agent could plant).
 */

import type { RealpathGuard } from "@kolu/serve-dir";
import { assertRealpathUnder } from "kolu-git";

/** The filesystem-authority guard padi injects into `@kolu/serve-dir` for a
 *  given root: resolve symlinks and reject anything whose real path escapes the
 *  root. Wraps kolu-git's `assertRealpathUnder` into the `RealpathGuard` shape,
 *  matching kolu-server's shipped `previewRealpathGuard` byte-for-byte. */
export function previewRealpathGuard(root: string): RealpathGuard {
  return async (abs) => (await assertRealpathUnder(root, abs)).ok;
}
