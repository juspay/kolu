/**
 * Where a proxy listens. One source of truth, because the proxy creates the
 * path and every client — `acp-chat` today, pesu next — has to derive the same
 * one from nothing but the terminal id.
 *
 * The *shape* is deliberately the one the rest of kolu already uses for a
 * per-user rendezvous socket (`getRuntimeSocketPath` in
 * `@kolu/surface/unix-socket`, which kaval builds its pty-host path with), and
 * `socketPath.test.ts` pins that agreement. It is re-derived here rather than
 * imported because that module also pulls in the oRPC server, and this package
 * deliberately depends on nothing from `@kolu/surface` — both of its faces are
 * standard ACP, which is what lets it move out of this repo as a file move.
 * Fifteen lines of path arithmetic is the cheaper of the two duplications.
 */

import { join } from "node:path";

/** The app namespace both spellings share, matching kolu's other sockets. */
const APP = "kolu";

/**
 * `$XDG_RUNTIME_DIR/kolu/acp-<id>.sock` on systemd Linux, else the fixed
 * per-user `/tmp/kolu-$UID/acp-<id>.sock`.
 *
 * Not `os.tmpdir()` for the fallback: it honours `$TMPDIR`, which differs by
 * launch context — on macOS a launchd-spawned process gets a private
 * `/var/folders/…/T` while a `nix run` CLI gets `/tmp` — so a proxy and its
 * client would land on different sockets and never meet. `/tmp` is identical in
 * every process on both Linux and macOS, and the `-$UID` suffix keeps it
 * per-user. The caller creates the directory `0700` and the socket `0600`; on a
 * shared path that ownership is the security boundary, not the name.
 */
export function socketPathFor(id: string): string {
  return join(runtimeDir(), `acp-${id}.sock`);
}

/** The private per-user directory a proxy's socket lives in. */
export function runtimeDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg !== undefined && xdg !== "") return join(xdg, APP);
  const uid = process.getuid?.() ?? "shared";
  return `/tmp/${APP}-${uid}`;
}
