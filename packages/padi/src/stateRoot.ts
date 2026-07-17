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
import { readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import { gatePid, isHolderLive } from "@kolu/surface-daemon";
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

/** The per-client-ISOLATED default state-root: the host's OWN default estate
 *  ({@link defaultPadiStateRoot}) with a stable CLIENT identity appended to its
 *  leaf, so two kolu-servers binding one host reach DISTINCT estates (distinct
 *  digest → distinct socket + kaval) by construction — never the shared default
 *  rendezvous they would otherwise LIVELOCK over (each padi classifies the
 *  other's kaval as skew and recycles it, forever). Isolation is structural, not
 *  arbitrated: an old-closure padi can't honor a gate it predates, so the only
 *  fix that converges is not sharing the estate at all.
 *
 *  The base is still computed ON THE HOST (the identity-anchor invariant in
 *  {@link defaultPadiStateRoot}'s doc): only the opaque `clientId` crosses the
 *  wire, NEVER a client-computed path — so two ways of reaching the host can't
 *  split the estate. `clientId` MUST be stable-per-client (kolu-server's persisted
 *  UUID), so the SAME client re-attaches its own estate across restarts; an
 *  ephemeral id would mint a new estate every restart (a graveyard factory).
 *
 *  Rejects a `clientId` bearing a path separator — it names the estate's leaf, so
 *  a `/` or `..` must never let it climb out of the default state dir (fail fast,
 *  never silently place the estate somewhere unexpected). */
export function isolatedPadiStateRoot(clientId: string): string {
  if (clientId === "" || /[/\\]|\.\./.test(clientId)) {
    throw new Error(
      `padi: refusing an isolated state-root for an unsafe client id ${JSON.stringify(
        clientId,
      )} — a client id names the estate leaf and must not contain a path separator.`,
    );
  }
  return `${defaultPadiStateRoot()}-${clientId}`;
}

/** The ONE estate-precedence predicate: does this padi anchor to its per-client
 *  ISOLATED estate? True iff there is NO explicit override (`--state-root` /
 *  `KOLU_PADI_STATE_DIR`) AND a non-empty `clientId` is present. This is the sole
 *  spelling of "isolated on a client id" — {@link resolvePadiStateRoot} routes on
 *  it, and any OTHER site that must know whether the estate was isolated (e.g.
 *  daemonMain's one-time legacy-adopt guard) calls THIS rather than re-deriving
 *  the precedence from the raw inputs, so the two can never diverge on an edge
 *  (an empty-string clientId, a future third estate source). */
/** The estate-precedence decision, spelled ONCE: the explicit override
 *  (`--state-root` / `KOLU_PADI_STATE_DIR`) if any, and whether — absent it — a
 *  non-empty `clientId` isolates. Both {@link estateIsolatedByClient} and
 *  {@link resolvePadiStateRoot} read it here rather than re-spelling
 *  `override ?? env` (the exact two-copies-must-agree precedence a prior bug
 *  already diverged on). */
function resolveEstate(
  override?: string,
  clientId?: string,
): { explicit: string | undefined; isolated: boolean } {
  const explicit = override ?? process.env.KOLU_PADI_STATE_DIR;
  return {
    explicit,
    isolated: !explicit && clientId !== undefined && clientId !== "",
  };
}

export function estateIsolatedByClient(
  override?: string,
  clientId?: string,
): boolean {
  return resolveEstate(override, clientId).isolated;
}

/** Resolve the state-root a padi process should use, in precedence order:
 *  an explicit override (`--state-root` / `KOLU_PADI_STATE_DIR`, dev/e2e) wins;
 *  else, given a stable `clientId`, the per-client {@link isolatedPadiStateRoot}
 *  (the isolation-default for a remote binding); else the binary's
 *  {@link defaultPadiStateRoot} (a standalone/local padi with no client). Always
 *  absolute, so the digest is stable. The binder (kolu-server) resolves the SAME
 *  way and passes the result explicitly, so a supervised padi and its supervisor
 *  never disagree on the identity. */
export function resolvePadiStateRoot(
  override?: string,
  clientId?: string,
): string {
  const { explicit, isolated } = resolveEstate(override, clientId);
  if (isolated) return isolatedPadiStateRoot(clientId as string);
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

export const PADI_LOG_FILE = "padi.log";

/** padi's deterministic diagnostic log — `<state-root>/padi.log`. Every padi spawn path
 *  appends the daemon's stderr here (P0), so a padi that OUTLIVES the parent that spawned it
 *  (an ssh front, a kolu-server) still leaves a readable log instead of /dev/null. Homed on
 *  the PERSISTENT state root (not the ephemeral runtime socket dir) so it survives reboots
 *  and is trivial to find: same dir the daemon already owns, keyed by state-root identity. */
export function padiLogPath(stateRoot?: string): string {
  return join(resolvePadiStateRoot(stateRoot), PADI_LOG_FILE);
}

export const PADI_STDERR_LOG_FILE = "padi.stderr.log";

/** padi's raw-STDERR crash-catcher — `<state-root>/padi.stderr.log`. SEPARATE from
 *  {@link padiLogPath} (pino's structured, size-capped stream): this file captures what pino
 *  can't see — native `stderr` writes, an uncaught-exception / unhandled-rejection stack —
 *  the spawn spine hands it as the detached daemon's stderr fd (P0). Bounded by
 *  TRUNCATE-ON-BOOT (the spine rotates the previous to `.old` and starts fresh — one
 *  generation, never unbounded), so it needs no size rotation. */
export function padiStderrLogPath(stateRoot?: string): string {
  return join(resolvePadiStateRoot(stateRoot), PADI_STDERR_LOG_FILE);
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

/** The systemd-standard `$XDG_RUNTIME_DIR` value on Linux (`/run/user/$UID`) —
 *  what logind sets for any session it manages. Used ONLY as a SECOND drawer
 *  {@link discoverPadiDaemons} probes when THIS process's own `$XDG_RUNTIME_DIR`
 *  is unset (e.g. a bare `nix run` outside a login session) — a resident padi
 *  spawned in a DIFFERENT session that DID have it set is otherwise invisible
 *  to a caller that only ever computes its own drawer (the #1713 adopt-path
 *  sibling: the exact env-divergence that made a 30s "daemon socket never came
 *  up" boot hang look like padi failed to start, when a compatible resident was
 *  live the whole time at `/run/user/$UID`). Never used for CONSTRUCTION — a
 *  live padi always binds wherever ITS OWN env points, this is a discovery-only
 *  guess of the common case. `undefined` on a platform with no uid semantics
 *  (Windows), where there is no such standard drawer to guess. */
function standardXdgRuntimeDir(): string | undefined {
  const uid = process.getuid?.();
  return uid === undefined ? undefined : `/run/user/${uid}`;
}

/** Compute the decorated sentinel-digest dir `discoverPadiDaemons` pattern-matches
 *  against, evaluated under a SPECIFIC `$XDG_RUNTIME_DIR` value (`undefined` forces
 *  the `/tmp` fallback, mirroring {@link getRuntimeSocketPath}'s own branch) rather
 *  than this process's live env — the save/restore is synchronous (no `await`
 *  between), so it can't race another caller's view of the env (the same pattern
 *  kaval's `discoverKavalCandidates` uses via its own `socketPathForApp`). */
function sentinelDecoratedDirUnderRegime(
  xdgRuntimeDir: string | undefined,
): string {
  const saved = process.env.XDG_RUNTIME_DIR;
  if (xdgRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = xdgRuntimeDir;
  try {
    return dirname(
      getRuntimeSocketPath({ app: padiNamespace("0"), file: PADI_SOCK_FILE }),
    );
  } finally {
    if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = saved;
  }
}

/** Every padi candidate under ONE runtime-root regime (this process's own env,
 *  the forced `/tmp` fallback, or the systemd-standard `/run/user/$UID` guess) —
 *  the single-regime scan {@link discoverPadiDaemons} unions across every regime
 *  it checks. Reads the runtime root and the `padi-<digest>` decoration back from
 *  the SAME {@link getRuntimeSocketPath} builder a live padi constructs its socket
 *  with (a sentinel digest whose literal `0` becomes a `([0-9a-f]+)` capture), so
 *  discovery can never spell the path shape differently than construction. */
function padiCandidatesUnderRegime(
  xdgRuntimeDir: string | undefined,
): PadiDaemon[] {
  // The decorated dir for a sentinel digest: `<root>/padi-0[-$UID]/padi.sock`.
  // Whatever shape surface gives it (XDG `padi-0/`, or `/tmp` `padi-0-$UID/`) the
  // decoration is baked in, never re-decided here.
  const decoratedDir = sentinelDecoratedDirUnderRegime(xdgRuntimeDir);
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

/** The canonical (symlink-resolved) form of `path`, or `path` verbatim if it
 *  can't be resolved (already unlinked, or a broken link) — the de-dup key that
 *  collapses two spellings of the same daemon into one (mirrors kaval's
 *  `discoverKavalCandidates`). */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Discover every running padi daemon on this host — the read-only enumeration the
 *  Padi info dialog lists so a LEAKED padi (a second padi at a different state-root)
 *  is visible at a glance. Mirrors kaval's `discoverKavalDaemons`, EXTENDED past its
 *  own precedent: kaval's discovery unions this process's own env-derived drawer with
 *  the forced `/tmp` fallback (fixing "an XDG-set caller misses a /tmp resident"), but
 *  never checks the systemd-standard `/run/user/$UID` when its OWN env lacks
 *  `$XDG_RUNTIME_DIR` — so an XDG-unset caller still misses an XDG-drawer resident
 *  (kaval accepted that gap as a diagnostic-only limitation; see its own discovery
 *  test). padi's ADOPT path (`ensurePadiBinding`/`residentPadiSocket`) cannot accept
 *  it — that asymmetry IS the reported bug (#1713 adopt-path sibling): a 30s "daemon
 *  socket never came up" hang against a resident that was live the whole time at
 *  `/run/user/$UID`. So this unions THREE regimes: this process's own env-derived
 *  drawer, the forced `/tmp` fallback, and the systemd-standard `/run/user/$UID`
 *  guess (`extraRegimes`, always checked, even when this process's own XDG is unset)
 *  — de-duped by canonical path. `extraRegimes` defaults to the real guess; a test
 *  substitutes a fabricated drawer, since a unit test cannot write under the real
 *  `/run/user/$UID` (root-owned outside a real login session).
 *
 *  Each regime's scan reuses kaval's owner-only privacy check + socket-inode check
 *  (the same boundary the serving side enforces) so a sibling another local user
 *  planted under a shared `/tmp` root is never read. It stats dirs, reads the gate
 *  file, and reads the manifest, but NEVER dials, kills, or reaps a daemon — strictly
 *  read-only. Never throws (an unreadable root → it contributes nothing). */
export function discoverPadiDaemons(
  extraRegimes: readonly (string | undefined)[] = [standardXdgRuntimeDir()],
): PadiDaemon[] {
  const regimes: readonly (string | undefined)[] = [
    process.env.XDG_RUNTIME_DIR,
    undefined,
    ...extraRegimes,
  ];
  const byPath = new Map<string, PadiDaemon>();
  for (const xdgRuntimeDir of regimes) {
    for (const daemon of padiCandidatesUnderRegime(xdgRuntimeDir)) {
      const key = canonicalPath(daemon.socket);
      if (!byPath.has(key)) byPath.set(key, daemon);
    }
  }
  return [...byPath.values()];
}

/**
 * Find a resident padi ALREADY registered for `stateRoot` — the read-back
 * {@link ensurePadiBinding}'s wait/adopt side dials INSTEAD OF its own-env-computed
 * socket. Built on {@link discoverPadiDaemons} (which now unions every drawer this
 * host could plausibly have registered one under), filtered to daemons whose
 * `state-root` manifest names THIS exact state-root — the manifest is what the
 * resident actually wrote about itself, so it wins over any caller's own-env guess
 * (never a bare digest-path recompute, which is exactly what reproduced the bug).
 *
 * A manifest match alone is NOT enough: a crashed padi's `/tmp` registration (the
 * inode + its manifest both survive a crash — nothing wipes `/tmp` on exit the way
 * a boot-wiped `$XDG_RUNTIME_DIR` is wiped) can otherwise SHADOW a genuinely live
 * resident registered in a later regime, so we additionally gate on the manifest's
 * `padi.pid` gate holder being ALIVE ({@link isHolderLive}) — the same liveness test
 * the gate mechanism itself uses to tell a real holder from a stale one. Without
 * this, adopting the dead match would hand the caller a socket nothing answers on
 * (a hang), or — worse — cause it to spawn a SECOND padi onto a state root a live
 * resident already serves (the #1313 isolation property broken). A dead match is
 * simply ignored (never returned as a fallback): a stale socket must never shadow
 * a fresh spawn.
 *
 * Returns the live resident's socket path, or `undefined` when no discovered padi's
 * manifest names this state-root with a LIVE gate holder (a fresh boot, or only a
 * dead registration — the caller spawns at its own drawer, unchanged).
 */
export function residentPadiSocket(
  stateRoot: string,
  extraRegimes?: readonly (string | undefined)[],
): string | undefined {
  const resolved = resolve(stateRoot);
  const discovered =
    extraRegimes === undefined
      ? discoverPadiDaemons()
      : discoverPadiDaemons(extraRegimes);
  return discovered.find(
    (d) =>
      d.stateRoot !== null &&
      resolve(d.stateRoot) === resolved &&
      daemonIsLive(d),
  )?.socket;
}

/** A discovered daemon whose gate holder is PROVEN alive — the one liveness
 *  rule both live-consumers (`residentPadiSocket`, `resolveRunningPadiSocket`)
 *  narrow the raw `discoverPadiDaemons()` list with. It stays a shared predicate
 *  (not folded into discovery, which is deliberately raw so the info dialogs can
 *  list leaked/dead registrations at a glance) so a future refinement — a
 *  socket-inode check, a grace window on an unreadable gate pid — lands in ONE
 *  place and the two paths can't drift into classifying the same daemon
 *  differently (the corpse-dial / double-spawn class both guards prevent). */
function daemonIsLive(d: PadiDaemon): boolean {
  return d.gatePid !== null && isHolderLive(d.gatePid);
}

/** The outcome of resolving which running padi to dial — the whole selection
 *  policy lives here (beside the namespace construction it inverts), so a client
 *  (`padi-tui`) only renders the `many` ambiguity in its own error surface. Each
 *  arm carries the socket to dial; `many` carries the labeled candidates instead
 *  so the CLI prints a pick-one list. Mirrors kaval's `KavalSocketResolution`. */
export type PadiSocketResolution =
  | { kind: "explicit" | "stateRoot" | "env" | "one" | "none"; socket: string }
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
  // Gate discovery on a LIVE gate holder — the shared {@link daemonIsLive}
  // predicate `residentPadiSocket` applies too. A discovered daemon is only a
  // directory + gate-pid registration; a dead one (its holder gone, the socket
  // stale) must not be classified `one`/`many`, or a client dials a corpse and
  // gets an opaque ECONNREFUSED instead of the honest `none` → default-path
  // error. A registration whose gate-pid is unreadable (`null`) is likewise not
  // a proven-live daemon, so it drops out too.
  const found = discoverPadiDaemons().filter(daemonIsLive);
  const [first, ...rest] = found;
  if (first !== undefined && rest.length === 0) {
    return { kind: "one", socket: first.socket };
  }
  if (rest.length > 0) return { kind: "many", candidates: found };
  return { kind: "none", socket: padiSocketPath(resolvePadiStateRoot()) };
}
