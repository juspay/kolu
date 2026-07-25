/**
 * Where a proxy listens. One source of truth, because the proxy creates the
 * path and every client — `acp-chat` today, pesu next — has to derive the same
 * one from nothing but the terminal id.
 */

import { join } from "node:path";

/**
 * `$XDG_RUNTIME_DIR/kolu/acp-<id>.sock`.
 *
 * `XDG_RUNTIME_DIR` is required: it is the only directory on a Linux session
 * that is per-user, mode 0700, and cleaned up at logout. Falling back to `/tmp`
 * would silently move a 0600 socket into a world-readable directory, so an
 * absent value is an error rather than a default.
 */
export function socketPathFor(id: string): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (!runtimeDir) {
    throw new Error(
      "XDG_RUNTIME_DIR is not set; acp-proxy has nowhere private to put its socket",
    );
  }
  return join(runtimeDir, "kolu", `acp-${id}.sock`);
}
