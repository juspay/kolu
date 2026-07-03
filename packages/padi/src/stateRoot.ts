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
import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gatePid } from "@kolu/surface-daemon";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import {
  getPtyHostSocketPath,
  isPrivateOwnedDir,
  isSocketInode,
  readStateRootManifest,
} from "kaval";

// The `state-root` manifest (digest → state-root) is OWNED by kaval, beside the
// discovery that reads it (the dependency arrow points padi → kaval, never the
// reverse). Re-exported here so padi callers reach it through the same module as
// the rest of padi's rendezvous paths. `readStateRootManifest` is imported above
// (not re-exported — kolu-common already re-exports it) for padi discovery below.
export { writeStateRootManifest } from "kaval";

/** The socket filename padi serves inside its `padi-<digest>/` runtime dir. */
export const PADI_SOCK_FILE = "padi.sock";

/** The gate filename padi's single-instance lock claims, beside the socket. */
export const PADI_GATE_FILE = "padi.pid";

/** The default state-root the padi binary spells ON the host —
 *  `$HOME/.local/state/padi` (the OS passwd home if `$HOME` is unset). Persistent
 *  (survives reboots), distinct from kolu-server's `~/.config/kolu` config (session
 *  layout is *state*, not user *config*).
 *
 *  Deliberately **env-insensitive** — it does NOT honor `$XDG_STATE_HOME`, even
 *  though that is the XDG-standard base for state. This is an IDENTITY anchor, not
 *  a user-tunable config path: `$XDG_STATE_HOME` is set in some launch contexts (a
 *  login shell) and unset in others (a bare systemd unit, an `ssh` exec), so
 *  honoring it would let two contexts — the binder and padi, or two binder launches
 *  — resolve DIFFERENT roots and split padi's identity + saved session. `$HOME` is
 *  stable across every context, so the digest is the same wherever it is computed.
 *  Crashes loudly if no home resolves — a bare launch with no anchor must fail
 *  fast, never silently pick a throwaway path that would strand the saved session.
 *  A client wanting a custom path passes `KOLU_PADI_STATE_DIR` / `--state-root`. */
export function defaultPadiStateRoot(): string {
  const home = process.env.HOME || homedir();
  if (home) return join(resolve(home), ".local", "state", "padi");
  throw new Error(
    "padi: cannot resolve a default state-root — set $HOME, or pass an explicit " +
      "--state-root / KOLU_PADI_STATE_DIR. A bare launch with no anchor is refused " +
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

/** A discovered padi daemon — its socket, the state-root its `state-root` manifest
 *  records (or `null` if unreadable), and the gate-holder pid read from `padi.pid`
 *  beside the socket (or `null`). Strictly read-only diagnostic data; produced by
 *  {@link discoverPadiDaemons}. */
export interface PadiDaemon {
  socket: string;
  stateRoot: string | null;
  gatePid: number | null;
}

/** Discover every running padi daemon on this host — the read-only enumeration the
 *  Padi info dialog lists so a LEAKED padi (a second padi at a different state-root)
 *  is visible at a glance. Mirrors kaval's `discoverKavalDaemons`: it reads the
 *  runtime root and the `padi-<digest>` decoration back from the SAME
 *  {@link getRuntimeSocketPath} builder a live padi constructs its socket with (a
 *  sentinel digest whose literal `0` becomes a `([0-9a-f]+)` capture), so discovery
 *  can never spell the path shape differently than construction. Reuses kaval's
 *  owner-only privacy check + socket-inode check (the same boundary the serving side
 *  enforces) so a sibling another local user planted under a shared `/tmp` root is
 *  never read. It stats dirs, reads the gate file, and reads the manifest, but NEVER
 *  dials, kills, or reaps a daemon — strictly read-only. Never throws (an unreadable
 *  root → []). */
export function discoverPadiDaemons(): PadiDaemon[] {
  // The decorated dir for a sentinel digest: `<root>/padi-0[-$UID]/padi.sock`.
  // Whatever shape surface gives it (XDG `padi-0/`, or `/tmp` `padi-0-$UID/`) the
  // decoration is baked in, never re-decided here.
  const decoratedDir = dirname(
    getRuntimeSocketPath({ app: padiNamespace("0"), file: PADI_SOCK_FILE }),
  );
  const root = dirname(decoratedDir);
  const decoratedName = basename(decoratedDir);
  const decoratedRe = new RegExp(
    `^${decoratedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "([0-9a-f]+)")}$`,
  );

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: PadiDaemon[] = [];
  for (const name of entries) {
    if (decoratedRe.exec(name) === null) continue;
    const dir = join(root, name);
    // The same owner-only boundary the serving side enforces — a name match alone
    // is never ownership under the shared `/tmp` root.
    if (!isPrivateOwnedDir(dir)) continue;
    const socket = join(dir, PADI_SOCK_FILE);
    // The inode must itself be an actual socket, not any file a name-squatter dropped.
    if (!isSocketInode(socket)) continue;
    found.push({
      socket,
      stateRoot: readStateRootManifest(dir) ?? null,
      gatePid: gatePid(join(dir, PADI_GATE_FILE)) ?? null,
    });
  }
  return found;
}

/** The outcome of resolving which running padi to dial — the whole selection
 *  policy lives here (beside the namespace construction it inverts), so a client
 *  (`padi-tui`) only renders the `many` ambiguity in its own error surface. Each
 *  arm carries the socket to dial; `many` carries the labeled candidates instead
 *  so the CLI prints a pick-one list. Mirrors kaval's `KavalSocketResolution`. */
export type PadiSocketResolution =
  | { kind: "explicit"; socket: string }
  | { kind: "stateRoot"; socket: string }
  | { kind: "env"; socket: string }
  | { kind: "one"; socket: string; stateRoot: string | null }
  | { kind: "none"; socket: string }
  | { kind: "many"; candidates: PadiDaemon[] };

/**
 * Resolve which running padi a client should dial — the client-side companion to
 * {@link discoverPadiDaemons}, in precedence order:
 *   1. an explicit `--socket` path wins verbatim (a user-supplied override);
 *   2. an explicit `--state-root` resolves through the SAME digest→socket path a
 *      padi computes for itself, so a dev/e2e client and its private padi agree;
 *   3. `$PADI_SOCKET` — stamped into every PTY a padi spawns (the `$TMUX` /
 *      `$KAVAL_SOCKET` convention) — points at the daemon that OWNS this terminal,
 *      so a flag-less `padi-tui` inside a kolu terminal "just works" and an agent
 *      driving its siblings never scans or guesses a digest-keyed path;
 *   4. else discover the running padi: exactly one → `one`; several → `many` (the
 *      CLI renders a labeled pick-one); none → `none` with the default state-root's
 *      socket, so a connect error names a sensible path.
 */
export function resolveRunningPadiSocket(opts?: {
  socket?: string;
  stateRoot?: string;
}): PadiSocketResolution {
  if (opts?.socket !== undefined && opts.socket !== "") {
    return { kind: "explicit", socket: opts.socket };
  }
  if (opts?.stateRoot !== undefined && opts.stateRoot !== "") {
    return {
      kind: "stateRoot",
      socket: padiSocketPath(resolvePadiStateRoot(opts.stateRoot)),
    };
  }
  const env = process.env.PADI_SOCKET;
  if (env) return { kind: "env", socket: env };
  const found = discoverPadiDaemons();
  const [first, ...rest] = found;
  if (first !== undefined && rest.length === 0) {
    return { kind: "one", socket: first.socket, stateRoot: first.stateRoot };
  }
  if (rest.length > 0) return { kind: "many", candidates: found };
  return { kind: "none", socket: padiSocketPath(resolvePadiStateRoot()) };
}
