import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  gatePid,
  isPrivateOwnedDir,
  type ResolvedDaemonHome,
  resolveDaemonHome,
} from "@kolu/surface-daemon";

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

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/<app>/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/<app>-$UID/pty-host.sock`. `app` is a bare stem (default
 *  `"kolu"`, production kaval uses `"kaval"`) — never a pre-joined
 *  `kaval-<digest>` / `kaval-<port>` (use {@link legacyKavalSocketPath} or
 *  `instance` mode for those). Path algebra is {@link resolveDaemonHome}. */
export function getPtyHostSocketPath(override?: string, app = "kolu"): string {
  if (override !== undefined && override !== "") return override;
  return resolveDaemonHome({
    app,
    placement: "runtime",
    socketFile: PTY_HOST_SOCK_FILE,
  }).socketPath;
}

/** The LEGACY per-port kaval socket path — `$XDG_RUNTIME_DIR/kaval-<port>/
 *  pty-host.sock` — as the pre-W2.2 in-process kolu-server minted it. */
export function legacyKavalSocketPath(port: number): string {
  return resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    instance: String(port),
    socketFile: PTY_HOST_SOCK_FILE,
  }).socketPath;
}

export { isPrivateOwnedDir };

/** Every surviving `<ns>/pty-host.sock` under the runtime root, each labeled by
 *  the namespace branch it matched. Strictly read-only: it stats dirs and reads
 *  manifests, never dials, kills or reaps; an unreadable root yields []. */
export function discoverKavalCandidates(): KavalSocketCandidate[] {
  const bareDir = kavalHome().dir;
  const root = dirname(bareDir);
  const bareName = basename(bareDir);

  const decoratedName = basename(kavalHome("0").dir);
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
    const dir = join(root, name);
    if (name !== bareName && decoratedRe.exec(name) === null) continue;
    if (!isPrivateOwnedDir(dir)) continue;

    const sock = join(dir, PTY_HOST_SOCK_FILE);
    if (!isSocketInode(sock)) continue;
    found.push({
      socket: sock,
      ...classifyNamespace(dir, name, bareName, decoratedRe),
    });
  }
  return found;
}

function classifyNamespace(
  dir: string,
  name: string,
  bareName: string,
  decoratedRe: RegExp,
): { label: string; kind: KavalCandidateKind; stateRoot?: string } {
  if (name === bareName) {
    return { label: "standalone kaval", kind: "standalone" };
  }
  const suffix = decoratedRe.exec(name)?.[1] ?? "";
  const stateRoot = readStateRootManifest(dir);
  if (stateRoot !== undefined) {
    return { label: `kolu @ ${stateRoot}`, kind: "stateRoot", stateRoot };
  }
  if (/^\d+$/.test(suffix)) {
    return { label: `kolu-server on port ${suffix}`, kind: "port" };
  }
  return { label: `kaval ${suffix}`, kind: "unknown" };
}

function kavalHome(instance?: string): ResolvedDaemonHome {
  return resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    instance,
    socketFile: PTY_HOST_SOCK_FILE,
  });
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

/** Which running kaval to dial: an explicit path wins, then `$KAVAL_SOCKET`,
 *  then discovery — exactly one is `one`, several are `many` (the caller
 *  renders the choice), none is the default namespace path. */
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
    return { kind: "many", candidates: found };
  }
  return {
    kind: "none",
    socket: getPtyHostSocketPath(undefined, KAVAL_NS_PREFIX),
  };
}
