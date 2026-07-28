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
 *     it. **Bind resolution requires an explicit path** (`--state-root` /
 *     `KOLU_PADI_STATE_DIR`) — there is no silent default (#1334: a bare launch
 *     must never inherit production's chair). Production wrappers export the
 *     well-known path via {@link productionPadiStateRoot}'s formula; dev/e2e set a
 *     private dir. A remote client never invents the path — the host-side
 *     wrapper or binder supplies it.
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
import { gatePid, isHolderLive, resolveDaemonHome } from "@kolu/surface-daemon";
import {
  isPrivateOwnedDir,
  isSocketInode,
  KAVAL_NS_PREFIX,
  PTY_HOST_SOCK_FILE,
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

/** The well-known **production** state-root formula ON the host —
 *  `$HOME/.local/state/padi` (the OS passwd home if `$HOME` is unset). Persistent
 *  (survives reboots), distinct from kolu-server's `~/.config/kolu` config (session
 *  layout is *state*, not user *config*).
 *
 *  **Not a bind default** — {@link resolvePadiStateRoot} never falls back here
 *  (juspay/kolu#1334). Production nix wrappers export this path as
 *  `KOLU_PADI_STATE_DIR`; read-only discovery uses it only to name a sensible
 *  socket when no daemon is found. Deliberately **env-insensitive** — it does
 *  NOT honor `$XDG_STATE_HOME` (set in some launch contexts, unset in others), so
 *  two contexts can't compute two "production" paths and split identity. `$HOME`
 *  is stable across every context. Crashes if no home resolves. */
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
 *  absolute, so the digest is stable. The binder (kolu-server) resolves the SAME
 *  way and pins the result when spawning, so a supervised padi and its supervisor
 *  never disagree on the identity. Production wrappers and `pnpm dev` / tests each
 *  set the env; a bare process without either crashes with one line. */
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

/** Pure padi runtime home for a state-root — full `ResolvedDaemonHome` so
 *  construction can take gate + socket from one resolve (override paths still
 *  use {@link padiGatePath} beside the socket). */
export function padiRuntimeHome(stateRoot: string) {
  return resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: padiDigest(stateRoot),
  });
}

/** The socket path padi serves on: `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`
 *  (override wins verbatim). Takes the STATE-ROOT and derives the digest itself —
 *  the same shape as {@link padiKavalSocketPath}, so a caller never hand-threads a
 *  digest (and can't pass a state-root where a digest was expected). Path algebra
 *  is {@link resolveDaemonHome} with `instance` = the digest. */
export function padiSocketPath(stateRoot: string, override?: string): string {
  if (override !== undefined && override !== "") return override;
  return padiRuntimeHome(stateRoot).socketPath;
}

/** padi's single-instance gate beside a socket — for override/discovered
 *  sockets where only the socket path is known. Construction uses
 *  {@link padiRuntimeHome}.gatePath instead. */
export function padiGatePath(socketPath: string): string {
  return join(dirname(socketPath), PADI_GATE_FILE);
}

export const PADI_LOG_FILE = "padi.log";

/** padi's deterministic diagnostic log — `<state-root>/padi.log`. Every padi spawn path
 *  appends the daemon's stderr here (P0), so a padi that OUTLIVES the parent that spawned it
 *  (an ssh front, a kolu-server) still leaves a readable log instead of /dev/null. Homed on
 *  the PERSISTENT state root (not the ephemeral runtime socket dir) so it survives reboots
 *  and is trivial to find: same dir the daemon already owns, keyed by state-root identity.
 *
 *  `stateRoot` is the already-resolved bind path — pure join, no ambient
 *  {@link resolvePadiStateRoot} (callers resolve once at entry). */
export function padiLogPath(stateRoot: string): string {
  return join(resolve(stateRoot), PADI_LOG_FILE);
}

export const PADI_STDERR_LOG_FILE = "padi.stderr.log";

/** padi's raw-STDERR crash-catcher — `<state-root>/padi.stderr.log`. SEPARATE from
 *  {@link padiLogPath} (pino's structured, size-capped stream): this file captures what pino
 *  can't see — native `stderr` writes, an uncaught-exception / unhandled-rejection stack —
 *  the spawn spine hands it as the detached daemon's stderr fd (P0). Bounded by
 *  TRUNCATE-ON-BOOT (the spine rotates the previous to `.old` and starts fresh — one
 *  generation, never unbounded), so it needs no size rotation.
 *
 *  `stateRoot` is the already-resolved bind path — pure join, no ambient bind resolve. */
export function padiStderrLogPath(stateRoot: string): string {
  return join(resolve(stateRoot), PADI_STDERR_LOG_FILE);
}

/** The socket padi's kaval serves on: `$XDG_RUNTIME_DIR/kaval-<digest>/
 *  pty-host.sock`, keyed by the SAME digest as padi (retires the legacy
 *  `kaval-<port>`). Via {@link resolveDaemonHome} instance mode so construction
 *  matches kaval discovery under `kaval-*`. */
export function padiKavalSocketPath(
  stateRoot: string,
  override?: string,
): string {
  if (override !== undefined && override !== "") return override;
  return resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    instance: padiDigest(stateRoot),
    socketFile: PTY_HOST_SOCK_FILE,
  }).socketPath;
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
 *  the `/tmp` fallback, mirroring {@link resolveDaemonHome}'s own branch) rather
 *  than this process's live env — the save/restore is synchronous (no `await`
 *  between), so it can't race another caller's view of the env (the same pattern
 *  kaval's `discoverKavalCandidates` uses via its own `socketPathForApp`). */
function sentinelDecoratedDirUnderRegime(
  xdgRuntimeDir: string | undefined,
): string {
  // Pure regime plug — never mutates process.env. `undefined` forces `/tmp`.
  return resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: "0",
    runtimeRoot: xdgRuntimeDir === undefined ? null : xdgRuntimeDir,
  }).dir;
}

/** Every padi candidate under ONE runtime-root regime (this process's own env,
 *  the forced `/tmp` fallback, or the systemd-standard `/run/user/$UID` guess) —
 *  the single-regime scan {@link discoverPadiDaemons} unions across every regime
 *  it checks. Reads the runtime root and the `padi-<digest>` decoration back from
 *  the SAME {@link resolveDaemonHome} builder a live padi constructs its socket
 *  with (a sentinel digest whose literal `0` becomes a `([0-9a-f]+)` capture), so
 *  discovery can never spell the path shape differently than construction. */
function padiCandidatesUnderRegime(
  xdgRuntimeDir: string | undefined,
): PadiDaemon[] {
  // The decorated dir for a sentinel digest: `<root>/padi-0[-$UID]/`.
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
 *      CLI renders a labeled pick-one); none → `none` with a *named* socket for
 *      the error path: explicit/`KOLU_PADI_STATE_DIR` when set, else the
 *      production formula ({@link productionPadiStateRoot}) — never a throwing
 *      bind resolve.
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
  // gets an opaque ECONNREFUSED instead of the honest `none` → named-path
  // error. A registration whose gate-pid is unreadable (`null`) is likewise not
  // a proven-live daemon, so it drops out too.
  const found = discoverPadiDaemons().filter(daemonIsLive);
  const [first, ...rest] = found;
  if (first !== undefined && rest.length === 0) {
    return { kind: "one", socket: first.socket };
  }
  if (rest.length > 0) return { kind: "many", candidates: found };
  return {
    kind: "none",
    socket: padiSocketPath(namePadiStateRootForDiscovery()),
  };
}

/** Read-only chair naming for dial/error paths when no live daemon was found.
 *  Honors `KOLU_PADI_STATE_DIR` when set so isolated dev/e2e name *their* root;
 *  otherwise the production formula. Never throws for a missing env (unlike
 *  {@link resolvePadiStateRoot}). */
export function namePadiStateRootForDiscovery(): string {
  const env = process.env.KOLU_PADI_STATE_DIR;
  if (env !== undefined && env !== "") return resolve(env);
  return productionPadiStateRoot();
}
