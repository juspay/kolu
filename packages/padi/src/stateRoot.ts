/**
 * padi's identity — its **state-root** (the persistent folder that holds its
 * data) — and the **digest-keyed runtime rendezvous** derived from it. This is
 * the one place the `(host, state-root)` identity is spelled, so a client and
 * the daemon compute the same paths.
 *
 * Two kinds of location, deliberately split (each mechanic exists because a
 * reviewer constructed the failure without it — see padi.mdx §identity):
 *
 *   - **The state-root is PERSISTENT.** It survives reboots — restore depends on
 *     it. Its default is spelled by the padi binary, ON the host, by
 *     {@link defaultPadiStateRoot} — never computed by a remote client and sent
 *     over the wire, because two ways of reaching a host (login shell vs ssh,
 *     different env) could compute two different "defaults" and silently split
 *     the host's terminals across two padis. A client passes nothing (default)
 *     or an explicit path (dev/e2e).
 *
 *   - **The socket + gate + manifest are EPHEMERAL.** They live in the
 *     boot-wiped runtime dir (`$XDG_RUNTIME_DIR/padi-<digest>/`,
 *     `kaval-<digest>/`), named by a {@link padiDigest} of the state-root path.
 *     Boot-wiping is load-bearing: the pid gate's liveness check reads a
 *     `kill(pid,0)` EPERM as "alive" ({@link acquirePidGate} via
 *     `@kolu/surface-daemon`), so a stale gate must never outlive the process
 *     that wrote it — which the runtime dir's boot wipe guarantees and a
 *     persistent state-root would not. The digest also keeps socket paths short
 *     no matter how deep the state-root sits.
 *
 * A tiny **manifest** (`state-root` file) in each runtime dir maps the opaque
 * digest back to its state-root, so a flag-less `kaval-tui` can still label what
 * it discovers.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { getPtyHostSocketPath } from "kaval";

// The `state-root` manifest (digest → state-root) is OWNED by kaval, beside the
// discovery that reads it (the dependency arrow points padi → kaval, never the
// reverse). Re-exported here so padi callers reach it through the same module as
// the rest of padi's rendezvous paths.
export { writeStateRootManifest } from "kaval";

/** The socket filename padi serves inside its `padi-<digest>/` runtime dir. */
export const PADI_SOCK_FILE = "padi.sock";

/** The gate filename padi's single-instance lock claims, beside the socket. */
export const PADI_GATE_FILE = "padi.pid";

/** The default state-root the padi binary spells ON the host — `$XDG_STATE_HOME/
 *  padi`, else `$HOME/.local/state/padi`. Persistent (survives reboots), distinct
 *  from kolu-server's `~/.config/kolu` config (session layout is *state*, not user
 *  *config*). Crashes loudly if neither `$XDG_STATE_HOME` nor a home dir resolves
 *  — a bare launch with no anchor must fail fast, never silently pick a throwaway
 *  path that would strand the saved session. A client passes an explicit path
 *  (dev/e2e) to bypass this default. */
export function defaultPadiStateRoot(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) return join(resolve(xdgStateHome), "padi");
  const home = process.env.HOME || homedir();
  if (home) return join(resolve(home), ".local", "state", "padi");
  throw new Error(
    "padi: cannot resolve a default state-root — set $XDG_STATE_HOME or $HOME, " +
      "or pass an explicit --state-root. A bare launch with no anchor is refused " +
      "rather than silently picking a throwaway path that would strand the session.",
  );
}

/** Resolve the state-root a padi process should use: an explicit override
 *  (`--state-root` / `KOLU_PADI_STATE_DIR`, dev/e2e) if set, else the binary's
 *  {@link defaultPadiStateRoot}. Always absolute, so the digest is stable. The
 *  binder (kolu-server) resolves the SAME way and passes the result explicitly,
 *  so a supervised padi and its supervisor never disagree on the identity. */
export function resolvePadiStateRoot(override?: string): string {
  const explicit = override ?? process.env.KOLU_PADI_STATE_DIR;
  return explicit ? resolve(explicit) : defaultPadiStateRoot();
}

/** A short, stable digest of the state-root path — the rendezvous key. A hex
 *  slice of a sha256 of the ABSOLUTE path: distinct state-roots yield distinct
 *  digests (the #1313 isolation property — two padis never touch each other's
 *  kaval), an identical state-root yields an identical digest (a re-boot dials
 *  the same daemon). Deliberately does NOT `realpath` (the dir may not exist at
 *  first boot, and a symlink resolving later must not change a live daemon's
 *  key); callers pass a resolved absolute path. */
export function padiDigest(stateRoot: string): string {
  return createHash("sha256")
    .update(resolve(stateRoot))
    .digest("hex")
    .slice(0, 16);
}

/** padi's runtime app-namespace: `padi-<digest>`. */
export function padiNamespace(digest: string): string {
  return `padi-${digest}`;
}

/** kaval's runtime app-namespace for THIS padi: `kaval-<digest>` (retires the
 *  legacy `kaval-<port>`). Keyed by the SAME digest as padi, so padi's kaval sits
 *  beside padi's socket and two padis at distinct state-roots get distinct kavals
 *  by construction. */
export function kavalNamespaceForDigest(digest: string): string {
  return `kaval-${digest}`;
}

/** The socket path padi serves on: `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`
 *  (override wins verbatim). Takes the STATE-ROOT and derives the digest itself —
 *  the same shape as {@link padiKavalSocketPath}, so a caller never hand-threads a
 *  digest (and can't pass a state-root where a digest was expected). */
export function padiSocketPath(stateRoot: string, override?: string): string {
  return getRuntimeSocketPath({
    app: padiNamespace(padiDigest(stateRoot)),
    file: PADI_SOCK_FILE,
    override,
  });
}

/** padi's single-instance gate, beside its socket — the same path padi's
 *  `daemonMain` derives, so a binder reads the true current holder. */
export function padiGatePath(socketPath: string): string {
  return join(dirname(socketPath), PADI_GATE_FILE);
}

/** padi's runtime rendezvous dir (parent of the socket) — where padi writes its
 *  own `state-root` manifest so a future padi-tui can label it too. */
export function padiRuntimeDir(stateRoot: string): string {
  return dirname(padiSocketPath(stateRoot));
}

/** The socket padi's kaval serves on: `$XDG_RUNTIME_DIR/kaval-<digest>/
 *  pty-host.sock`, keyed by the SAME digest as padi (retires the legacy
 *  `kaval-<port>`). Reuses kaval's own path builder with the digest namespace, so
 *  a flag-less `kaval-tui` discovers it under `kaval-*` just as before. */
export function padiKavalSocketPath(
  stateRoot: string,
  override?: string,
): string {
  return getPtyHostSocketPath(
    override,
    kavalNamespaceForDigest(padiDigest(stateRoot)),
  );
}
