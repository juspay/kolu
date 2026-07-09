/**
 * The well-known unix-socket path where kolu-server serves the in-process
 * pty-host and `kaval-tui` connects to it. Single source of truth so the
 * server and the CLI — two separate packages, two separate processes —
 * compute it identically.
 *
 * The rendezvous mechanics (why a stable path; why the off-systemd fallback
 * is a fixed `/tmp/<app>-$UID/`, NOT `os.tmpdir()` whose `$TMPDIR` form
 * diverged between a launchd server and a `nix run` CLI on macOS — the
 * "no pty-host socket at /tmp/kolu/..." bug) live with
 * `getRuntimeSocketPath` in `@kolu/surface/unix-socket`; this module just
 * pins kolu's names.
 *
 * padi spawns its kaval under a DIGEST-keyed namespace (`kaval-<digest>/`, the
 * digest taken from padi's state-root, with a `state-root` manifest beside the
 * socket so discovery can label it), so two padis on one box never collide on a
 * single gate (the prod incident where a second server recycled the first's
 * daemon). A bare standalone kaval is still `kaval/`. The legacy per-port
 * `kaval-<port>/` — the old in-process kolu-server keying — is retired; discovery
 * below still recognizes it for the transition. The consequence either way: there
 * is no one fixed path a flag-less `kaval-tui` can assume, so it
 * `discoverPtyHostSockets()` the running daemon instead.
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { gatePid } from "@kolu/surface-daemon";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";

/** The socket filename inside every kaval rendezvous dir. */
export const PTY_HOST_SOCK_FILE = "pty-host.sock";

/** The single-instance gate filename beside every kaval socket — its holder pid as
 *  decimal text (written by kaval's `daemonMain`, read via `gatePid`). One literal so
 *  the daemon, the supervisor's `kavalGatePath`, and read-only discovery agree on it. */
export const KAVAL_GATE_FILE = "kaval.pid";

/** The manifest filename mapping a digest-keyed rendezvous dir back to the
 *  padi state-root it belongs to. Written by padi (which knows both the digest
 *  and the state-root the opaque digest stands for), read by flag-less discovery
 *  to LABEL a `kaval-<digest>` dir it otherwise couldn't interpret. A legacy
 *  `kaval-<port>` dir has NO manifest — its port is meaning enough. */
export const STATE_ROOT_MANIFEST_FILE = "state-root";

export const KAVAL_LOG_FILE = "kaval.log";

/** kaval's deterministic diagnostic log — `<digest-keyed home>/kaval.log`, beside its socket.
 *  Every kaval spawn path appends the daemon's stderr here (P0) so a kaval that OUTLIVES the
 *  padi/kolu-server that spawned it still leaves a readable log instead of /dev/null. Ephemeral
 *  (the runtime home), but so is the daemon — deterministic while it lives, keyed by the same
 *  digest the socket is. */
export function kavalLogPath(socketPath: string): string {
  return join(dirname(socketPath), KAVAL_LOG_FILE);
}

/** Write the `state-root` manifest into a rendezvous dir, owner-only. Ensures the
 *  `0700` dir exists first (padi writes its kaval's manifest BEFORE kaval binds
 *  the socket, so the dir may not exist yet). Idempotent. Owned HERE, beside the
 *  discovery that reads it, so the on-disk format has one home (padi imports this
 *  for writing — the dependency arrow points padi → kaval, never the reverse). */
export function writeStateRootManifest(
  runtimeDir: string,
  stateRoot: string,
): void {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(runtimeDir, STATE_ROOT_MANIFEST_FILE), `${stateRoot}\n`, {
    mode: 0o600,
  });
}

/** Read the state-root a rendezvous dir's manifest records, or `undefined` if it
 *  has none (a legacy port-keyed kaval, or a bare standalone daemon). Never
 *  throws. */
export function readStateRootManifest(runtimeDir: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(runtimeDir, STATE_ROOT_MANIFEST_FILE), "utf8");
  } catch {
    return undefined;
  }
  const line = raw.split("\n", 1)[0]?.trim();
  return line ? line : undefined;
}

/** The app-namespace prefix kaval owns. A standalone daemon serves under it
 *  bare (`kaval/`); a padi's kaval decorates it with a digest of padi's
 *  state-root (`kaval-<digest>/`), and the legacy in-process kolu-server used the
 *  same decoration shape with a listen port (`kaval-<port>/`). The prefix is the
 *  one literal that ties construction and discovery together. */
export const KAVAL_NS_PREFIX = "kaval";

/** The legacy per-port app namespace — the retired in-process kolu-server keying
 *  (`kaval-<port>/`). No longer used to CONSTRUCT a live socket (padi keys by a
 *  state-root digest now); kept because discovery below probes it with a sentinel
 *  to learn the `<prefix>-<...>` decoration shape, and still recognizes such dirs
 *  for the transition. */
export function kavalNamespace(port: number): string {
  return `${KAVAL_NS_PREFIX}-${port}`;
}

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/<app>/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/<app>-$UID/pty-host.sock`. `app` is parameterized (default
 *  `"kolu"`) so a standalone daemon can own its own rendezvous namespace
 *  without the host name being hardcoded into the path. */
export function getPtyHostSocketPath(override?: string, app = "kolu"): string {
  return getRuntimeSocketPath({
    app,
    file: PTY_HOST_SOCK_FILE,
    override,
  });
}

/** The LEGACY per-port kaval socket path — `$XDG_RUNTIME_DIR/kaval-<port>/
 *  pty-host.sock` — the pre-W2.2 in-process kolu-server keying. Retired for
 *  CONSTRUCTION (padi keys its kaval by a state-root digest now), but a W2.2
 *  kolu-server hands THIS path (computed from its OWN listen port) to padi as an
 *  adopt HINT so the first W2.2 boot ADOPTS the running pre-W2.2 kaval instead of
 *  leaking it (the upgrade-migration bridge). Reuses {@link kavalNamespace} — the
 *  one `kaval-<port>` literal — so the hint and legacy discovery can never drift. */
export function legacyKavalSocketPath(port: number): string {
  return getPtyHostSocketPath(undefined, kavalNamespace(port));
}

/** Is `dir` a private, owner-only directory the current user owns? The SAME
 *  boundary `serveOverUnixSocket` / `acquirePidGate` enforce before serving (cf.
 *  `isPrivateOwnedDir` in `@kolu/surface/unix-socket`). It is re-checked HERE, on
 *  the connecting side, because a stable shared path (`/tmp/<app>-$UID`) is one
 *  any local user can pre-create: the `-$UID` in the NAME is not an ownership
 *  proof, so without this a flag-less `kaval-tui` would happily dial another
 *  user's planted socket and hand them its session. `lstatSync` (NOT `statSync`)
 *  so a symlink is judged as itself and rejected, never followed to a target the
 *  attacker still controls the `/tmp` component of. Returns true on platforms
 *  without uid semantics (Windows: `process.getuid` is undefined) — the ACL model
 *  there is out of scope. */
export function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
  } catch {
    // Couldn't stat at all — treat as not-private (skip) rather than assume safe.
    return false;
  }
}

/** Discover the rendezvous sockets of running pty-host daemons across BOTH
 *  per-user runtime roots — the env-derived `$XDG_RUNTIME_DIR/kaval*` AND the
 *  fixed `/tmp/kaval-$UID*` fallback — EACH LABELED by the branch that matched: a
 *  bare standalone `kaval/` (→ "standalone kaval"), a padi's digest-keyed
 *  `kaval-<digest>/` (labeled from its state-root manifest → "kolu @ <state-root>"),
 *  and, for the transition, a legacy `kaval-<port>/` (no manifest, numeric suffix
 *  → "kolu-server on port <port>"). Lets a flag-less `kaval-tui` dial the daemon
 *  without knowing padi's digest, and a `many`-candidate error name each one.
 *
 *  BOTH roots are scanned unconditionally, because a daemon registers in whichever
 *  drawer ITS binder's env pointed at — a daemon spawned with XDG unset lives under
 *  /tmp even on a host whose interactive processes have XDG set — so a discoverer
 *  that read only its own env-derived drawer would be blind to the other (the bug
 *  where the Kaval dialog and a nix-shell `kaval-tui` reported disjoint sets). The
 *  union is de-duped by canonical path. See {@link candidatesUnderRegime} for the
 *  per-root scan.
 *
 *  Neither root nor the env's namespace decoration is re-spelled here: both are
 *  READ BACK from `getRuntimeSocketPath` itself (the /tmp spelling via the builder
 *  with XDG forced off), so discovery can never spell the path shape differently
 *  than construction. Build the bare daemon's socket path, then walk back up — its
 *  grandparent is the root to scan, its parent's basename is the (possibly
 *  `-$UID`-decorated) bare namespace dir. The per-port pattern is the same
 *  decoration with a `(\d+)` capture substituted for the port, learnt from a probe
 *  build with port `0`.
 *
 *  Labeling is the INVERSE of `kavalNamespace`, derived from THIS match — not a
 *  later re-parse of the basename. That distinction matters: a re-parse of a bare
 *  `kaval-7692` basename alone can't tell a port from an off-XDG `-$UID` suffix
 *  and would have to hedge ("port 7692, or a standalone kaval"). Here, a name that
 *  equals `bareName` IS the standalone daemon and a name that matches the ported
 *  pattern IS a kolu-server — the ambiguity never arises because the matching
 *  branch already decided, against this user's actual `bareName`/`portedRe`.
 *
 *  A name match is necessary but NOT sufficient: every candidate's namespace dir
 *  must also pass the same owner-only privacy check the serving side enforces, so
 *  a sibling another local user planted under the shared `/tmp` root (whose name
 *  they can spell freely, `-$UID` and all) is never dialed. The socket inode must
 *  itself be a socket — not any file a name-squatter dropped in. Returns every
 *  surviving `<ns>/pty-host.sock`; never throws (an unreadable root → []). */
export function discoverKavalCandidates(): KavalSocketCandidate[] {
  // A kaval registers in ONE of two drawers, decided by the BINDER's env at spawn
  // time: `$XDG_RUNTIME_DIR/kaval*` when XDG is set (production padi/kolu-server),
  // else `/tmp/kaval-$UID*` (a nix-shell / e2e / test daemon with XDG unset). A
  // scan of only the DISCOVERER's own env-derived drawer is environment-blind: a
  // caller with XDG set (the Kaval dialog) never sees the /tmp daemons, and one
  // with XDG unset (a nix-shell kaval-tui) never sees the XDG daemon — the two
  // report DISJOINT sets on the same box. So union BOTH roots: the env-derived
  // one AND the fixed `/tmp` fallback, ALWAYS, whatever this process's env says.
  //
  // Both roots are read back from `getRuntimeSocketPath` — the SAME construction
  // the binder uses — so discovery can never spell a path the binder wouldn't.
  // The `/tmp` spelling is obtained by asking the builder with XDG forced off
  // (`forceTmp`), NOT by hand-writing `/tmp/kaval-$UID`.
  const candidates = [
    ...candidatesUnderRegime(false), // this process's env (XDG when set, else /tmp)
    ...candidatesUnderRegime(true), // the fixed /tmp fallback, always
  ];

  // De-dup by CANONICAL path: when XDG is unset both regimes resolve to /tmp (so
  // every candidate appears twice), and even with XDG set a daemon reachable via
  // two spellings (e.g. a symlinked runtime dir) must be listed once. `realpath`
  // collapses them; a socket that vanished mid-scan falls back to its raw path.
  const seen = new Set<string>();
  const unique: KavalSocketCandidate[] = [];
  for (const candidate of candidates) {
    const key = canonicalPath(candidate.socket);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

/** Build a kaval socket path exactly as {@link getRuntimeSocketPath} would, but
 *  under a chosen runtime-root regime: `forceTmp` evaluates the builder with
 *  `$XDG_RUNTIME_DIR` momentarily unset so it yields the fixed `/tmp/<app>-$UID`
 *  fallback even when this process has XDG set. The save/restore is synchronous
 *  and re-entrancy-free (no `await` between them, Node runs it on one thread), so
 *  it can never race another caller's view of the env. Reusing the builder — not
 *  re-spelling `/tmp/kaval-$UID` here — keeps discovery's path shape and
 *  construction's provably identical. */
function socketPathForApp(app: string, forceTmp: boolean): string {
  if (!forceTmp) {
    return getRuntimeSocketPath({ app, file: PTY_HOST_SOCK_FILE });
  }
  const saved = process.env.XDG_RUNTIME_DIR;
  delete process.env.XDG_RUNTIME_DIR;
  try {
    return getRuntimeSocketPath({ app, file: PTY_HOST_SOCK_FILE });
  } finally {
    if (saved !== undefined) process.env.XDG_RUNTIME_DIR = saved;
  }
}

/** The canonical (symlink-resolved) form of `path`, or `path` verbatim if it
 *  can't be resolved (already unlinked, or a broken link) — the de-dup key that
 *  collapses two spellings of the same daemon into one. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Every kaval candidate under ONE runtime-root regime (the env-derived root, or
 *  the forced `/tmp` fallback). The name grammar is regime-specific — off XDG the
 *  bare namespace is `kaval-$UID` and the decorated one `kaval-<x>-$UID` — so each
 *  regime derives its OWN `bareName`/`decoratedRe` from the builder, never a
 *  cross-regime reuse. {@link discoverKavalCandidates} unions and de-dups both. */
function candidatesUnderRegime(forceTmp: boolean): KavalSocketCandidate[] {
  // The bare daemon's socket: `<root>/<bareDir>/pty-host.sock`. Whatever shape
  // surface gives it (XDG `kaval/`, or `/tmp` `kaval-$UID/`) the decoration is
  // baked into `bareDir`, never re-decided here.
  const bareDir = dirname(socketPathForApp(KAVAL_NS_PREFIX, forceTmp));
  const root = dirname(bareDir);
  const bareName = basename(bareDir);

  // Learn the env's decoration from the builder too: a probe build with the
  // sentinel `0` yields the decorated per-instance name; turn its literal `0`
  // into a `([0-9a-f]+)` capture that matches BOTH a legacy `kaval-<port>` (the
  // in-process kolu-server, digits) AND a padi's `kaval-<digest>` (lowercase hex)
  // — then read the suffix back to disambiguate by the manifest below. (Escape
  // the rest so a `/tmp` path can't inject regex metacharacters.)
  const decoratedName = basename(
    dirname(socketPathForApp(kavalNamespace(0), forceTmp)),
  );
  const decoratedRe = new RegExp(
    `^${decoratedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "([0-9a-f]+)")}$`,
  );

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const found: KavalSocketCandidate[] = [];
  for (const name of entries) {
    // A name match alone is never ownership: require the namespace dir to be ours
    // and owner-only (the serving-side boundary), so a sibling another local user
    // planted under a shared `/tmp` root (whose name they can spell freely) is
    // never dialed or read.
    const dir = join(root, name);
    if (name !== bareName && decoratedRe.exec(name) === null) continue;
    if (!isPrivateOwnedDir(dir)) continue;

    // Classify by the branch that matches — this IS the label. A bare name is the
    // standalone daemon; a decorated one is EITHER a padi's `kaval-<digest>` (a
    // state-root manifest present → label by that state-root) OR a legacy
    // in-process kolu-server's `kaval-<port>` (no manifest, a numeric suffix →
    // label by port). Manifest presence is the discriminant, so a digest that
    // happens to be all-decimal never masquerades as a port.
    let label: string;
    let kind: KavalCandidateKind;
    let stateRoot: string | undefined;
    if (name === bareName) {
      label = "standalone kaval";
      kind = "standalone";
    } else {
      const suffix = decoratedRe.exec(name)?.[1] ?? "";
      stateRoot = readStateRootManifest(dir);
      if (stateRoot !== undefined) {
        label = `kolu @ ${stateRoot}`;
        kind = "stateRoot";
      } else if (/^\d+$/.test(suffix)) {
        label = `kolu-server on port ${suffix}`;
        kind = "port";
      } else {
        label = `kaval ${suffix}`;
        kind = "unknown";
      }
    }
    // The inode must itself be an actual socket — not any file a name-squatter
    // dropped in.
    const sock = join(dir, PTY_HOST_SOCK_FILE);
    if (isSocketInode(sock)) {
      found.push({ socket: sock, label, kind, stateRoot });
    }
  }
  return found;
}

/** Discover every running kaval daemon on this host, each enriched with its
 *  gate-holder pid (read from `kaval.pid` beside the socket, or `null` if
 *  unreadable) — the read-only enumeration the Kaval info dialog lists so a LEAKED
 *  pre-upgrade kaval is visible at a glance (it was only surfaced via a `kaval-tui`
 *  CLI error before). Reuses {@link discoverKavalCandidates} (the SAME discovery
 *  `kaval-tui` uses to report "more than one kaval daemon"); it stats dirs, reads
 *  the gate file, and reads the manifest, but NEVER dials, kills, or reaps a
 *  daemon — strictly read-only. */
export function discoverKavalDaemons(): KavalDaemon[] {
  return discoverKavalCandidates().map((candidate) => ({
    ...candidate,
    gatePid: gatePid(join(dirname(candidate.socket), KAVAL_GATE_FILE)) ?? null,
  }));
}

/** The discovered sockets as bare paths — the back-compat shape for callers that
 *  only need the paths (not the labels). `discoverKavalCandidates` is the source
 *  of truth; this drops the labels. */
export function discoverPtyHostSockets(): string[] {
  return discoverKavalCandidates().map((c) => c.socket);
}

/** Is `path` an actual socket inode? `lstatSync` (NOT `statSync`) so a symlink
 *  is judged as itself, never followed — a name-squatter must not be able to
 *  point us elsewhere with a link. A missing path or any non-socket inode → no. */
export function isSocketInode(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

/** Which namespace branch a discovered kaval matched — the STRUCTURAL kind decided
 *  at discovery's matching branch (never a later basename re-parse):
 *   - `standalone` — a bare `kaval/` daemon (`kaval` CLI, no padi);
 *   - `stateRoot`  — a padi's `kaval-<digest>/` (a `state-root` manifest present);
 *   - `port`       — the LEGACY pre-W2.2 in-process kolu-server `kaval-<port>/` (no
 *                    manifest, numeric suffix) — a kaval NOT owned by any padi, the
 *                    leak signal a post-upgrade orphan trips;
 *   - `unknown`    — a decorated name that is neither (defensive). */
export type KavalCandidateKind =
  | "standalone"
  | "stateRoot"
  | "port"
  | "unknown";

/** A labeled candidate kaval socket — the pasteable path, a human label that tells a
 *  kolu-server (port-namespaced) apart from a standalone daemon, the structured
 *  {@link KavalCandidateKind}, and the padi `stateRoot` its manifest records (only when
 *  `kind === "stateRoot"`). The label + kind are decided by `discoverKavalCandidates`
 *  at the matching branch (`bareName` → standalone, the ported pattern → a specific
 *  port), so neither is ever the hedged "port N, or a standalone" a basename re-parse
 *  would have to fall back to. */
export interface KavalSocketCandidate {
  socket: string;
  label: string;
  kind: KavalCandidateKind;
  /** The padi state-root this kaval belongs to (from its `state-root` manifest),
   *  present only when `kind === "stateRoot"`. */
  stateRoot?: string;
}

/** A discovered kaval daemon — a {@link KavalSocketCandidate} plus the gate-holder pid
 *  read from `kaval.pid` beside its socket (`null` if the gate is absent/malformed).
 *  Strictly read-only diagnostic data; produced by {@link discoverKavalDaemons}. */
export interface KavalDaemon extends KavalSocketCandidate {
  gatePid: number | null;
}

/** The outcome of resolving which running kaval to dial — the selection policy
 *  ("explicit wins; else discover; one→use it; many→ambiguous; none→default")
 *  lives here, beside the namespace construction it inverts, so a consumer only
 *  renders the `many`/`none` cases in its own error surface. */
export type KavalSocketResolution =
  | { kind: "explicit" | "env" | "one" | "none"; socket: string }
  | { kind: "many"; candidates: KavalSocketCandidate[] };

/** Resolve which running kaval to dial, in precedence order (the mirror of
 *  padi-tui's `resolveRunningPadiSocket`):
 *   1. an explicit `--socket` path wins verbatim — a user-supplied override;
 *   2. `$KAVAL_SOCKET` — stamped into every PTY a kaval/padi spawns (the `$TMUX`
 *      convention) — names the daemon that OWNS this terminal, so a flag-less
 *      `kaval-tui` INSIDE a kolu terminal "just works" and an agent driving its
 *      siblings never falls through to discovery's ambiguous `many`. Authoritative
 *      when set+non-empty: it SHORT-CIRCUITS discovery entirely (no scan runs);
 *   3. else discover the running daemon: padi keys its kaval by a digest of its
 *      state-root (`kaval-<digest>/`), so there is no single fixed path to assume.
 *      Exactly one found → `one`; more than one → `many`, each candidate LABELED
 *      (the caller renders a pick-one error); none → `none` with the bare `kaval`
 *      default, so a connect error names a sensible path. */
export function resolveRunningKavalSocket(
  explicit?: string,
): KavalSocketResolution {
  if (explicit !== undefined && explicit !== "") {
    return { kind: "explicit", socket: explicit };
  }
  const env = process.env.KAVAL_SOCKET;
  if (env !== undefined && env !== "") {
    return { kind: "env", socket: env };
  }
  const found = discoverKavalCandidates();
  const [first, ...rest] = found;
  if (first !== undefined && rest.length === 0) {
    return { kind: "one", socket: first.socket };
  }
  if (rest.length > 0) {
    // Each candidate already carries the label `discoverKavalCandidates` decided
    // at its matching branch — no re-parse, no hedge.
    return { kind: "many", candidates: found };
  }
  return {
    kind: "none",
    socket: getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX),
  };
}
