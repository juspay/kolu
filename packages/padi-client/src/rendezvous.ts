import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveDaemonHome } from "@kolu/surface-daemon/home";

/** The socket filename padi serves inside its `padi-<digest>/` runtime dir. */
export const PADI_SOCK_FILE = "padi.sock";

/** The gate filename padi's single-instance lock claims, beside the socket. */
export const PADI_GATE_FILE = "padi.pid";

/** The well-known **production** state-root formula ON the host —
 *  `$HOME/.local/state/padi` (the OS passwd home if `$HOME` is unset).
 *  Persistent, and distinct from kolu-server's `~/.config/kolu` config.
 *
 *  Not a bind default — {@link resolvePadiStateRoot} never falls back here.
 *  Env-insensitive: it does NOT honor `$XDG_STATE_HOME`. Crashes if no home
 *  resolves. */
export function productionPadiStateRoot(): string {
  const home = process.env.HOME || homedir();
  if (home) return join(resolve(home), ".local", "state", "padi");
  throw new Error(
    "padi: cannot resolve the production state-root formula — set $HOME, or pass " +
      "an explicit --state-root / KOLU_PADI_STATE_DIR.",
  );
}

/** Resolve the state-root a padi process should **bind** to. Requires an explicit
 *  override (`--state-root`) or `KOLU_PADI_STATE_DIR` — there is no silent default
 *  (juspay/kolu#1334: bare launch must not inherit production's identity). Always
 *  absolute, so the digest is stable. A bare process without either crashes with
 *  one line. */
export function resolvePadiStateRoot(override?: string): string {
  const explicit = override ?? process.env.KOLU_PADI_STATE_DIR;
  if (!explicit) {
    throw new Error(
      "KOLU_PADI_STATE_DIR must be set (or pass --state-root). Relative paths " +
        "are resolved against cwd. The nix-built kolu/padi wrappers, `pnpm dev`, " +
        "and the test harness each set their own — bare launches are rejected " +
        "to avoid clobbering production's padi state-root (juspay/kolu#1334).",
    );
  }
  return resolve(explicit);
}

/** A short, stable digest of the state-root path — the rendezvous key. A hex
 *  slice of a sha256 of the ABSOLUTE path: distinct state-roots yield distinct
 *  digests, an identical state-root yields an identical digest. Deliberately
 *  does NOT `realpath`; callers pass a resolved absolute path. */
export function padiDigest(stateRoot: string): string {
  return createHash("sha256")
    .update(resolve(stateRoot))
    .digest("hex")
    .slice(0, 16);
}

/** Pure padi runtime home for a state-root — full `ResolvedDaemonHome` so
 *  construction can take gate + socket from one resolve. Overrides (CLI
 *  `--socket`) are absorbed via `socketOverride`. */
export function padiRuntimeHome(stateRoot: string, socketOverride?: string) {
  return resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: padiDigest(stateRoot),
    socketOverride,
  });
}

/** The socket path padi serves on: `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`
 *  (override wins verbatim). Takes the STATE-ROOT and derives the digest itself.
 *  Path algebra is {@link resolveDaemonHome} with `instance` = the digest. */
export function padiSocketPath(stateRoot: string, override?: string): string {
  return padiRuntimeHome(stateRoot, override).socketPath;
}

/** padi's single-instance gate beside a socket — for override/discovered
 *  sockets where only the socket path is known. Construction uses
 *  {@link padiRuntimeHome}.gatePath instead. */
export function padiGatePath(socketPath: string): string {
  return join(dirname(socketPath), PADI_GATE_FILE);
}
