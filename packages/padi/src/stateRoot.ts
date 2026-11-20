import { readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { messageOf } from "@kolu/surface/errors";
import {
  PADI_GATE_FILE,
  PADI_SOCK_FILE,
  padiDigest,
  padiSocketPath,
  productionPadiStateRoot,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import {
  gatePid,
  isHolderLive,
  resolveDaemonHome,
  runtimeRegimeInForce,
} from "@kolu/surface-daemon";
import {
  isPrivateOwnedDir,
  isSocketInode,
  KAVAL_NS_PREFIX,
  PTY_HOST_SOCK_FILE,
  readStateRootManifest,
} from "kaval";
import { match } from "ts-pattern";

export { writeStateRootManifest } from "kaval";

export const PADI_LOG_FILE = "padi.log";

/** padi's deterministic diagnostic log — `<state-root>/padi.log`. Every padi spawn
 *  path appends the daemon's stderr here, so a padi that outlives the parent that
 *  spawned it still leaves a readable log. `stateRoot` is the already-resolved bind
 *  path: a pure join, never an ambient state-root resolve. */
export function padiLogPath(stateRoot: string): string {
  return join(resolve(stateRoot), PADI_LOG_FILE);
}

export const PADI_STDERR_LOG_FILE = "padi.stderr.log";

/** padi's raw-STDERR crash-catcher — `<state-root>/padi.stderr.log`, separate from
 *  {@link padiLogPath}: it holds what pino cannot see (native `stderr` writes, an
 *  uncaught-exception stack). Truncated on boot — one generation, never unbounded. */
export function padiStderrLogPath(stateRoot: string): string {
  return join(resolve(stateRoot), PADI_STDERR_LOG_FILE);
}

/** The kaval home for this padi — `kaval-<digest>/` under the runtime root, keyed by
 *  the SAME digest as padi. Construction and the supervisor both take this home. */
export function padiKavalHome(stateRoot: string, socketOverride?: string) {
  return resolveDaemonHome({
    app: KAVAL_NS_PREFIX,
    placement: "runtime",
    instance: padiDigest(stateRoot),
    socketFile: PTY_HOST_SOCK_FILE,
    socketOverride,
  });
}

/** The socket padi's kaval serves on — `<kaval home>/pty-host.sock`, via
 *  {@link padiKavalHome}. */
export function padiKavalSocketPath(
  stateRoot: string,
  override?: string,
): string {
  return padiKavalHome(stateRoot, override).socketPath;
}

/** The filename of the stable ssh-agent link in padi's runtime home — beside
 *  `padi.sock` / `padi.pid` / `state-root`. */
export const PADI_SSH_AUTH_SOCK_FILE = "ssh-auth.sock";

/** The stable ssh-agent link beside padi's serving socket —
 *  `<dirname(socketPath)>/ssh-auth.sock`. */
export function padiSshAuthSockPath(socketPath: string): string {
  return join(dirname(socketPath), PADI_SSH_AUTH_SOCK_FILE);
}

/** A discovered padi daemon — its socket, the state-root its `state-root` manifest
 *  records (`null` when unreadable), and the gate-holder pid read from `padi.pid`
 *  beside the socket (`null` when absent). Read-only diagnostic data produced by
 *  {@link discoverPadiDaemons}. */
export interface PadiDaemon {
  socket: string;
  stateRoot: string | null;
  gatePid: number | null;
}

function xdgRuntimeDirGuessForDiscovery(): string | undefined {
  const uid = process.getuid?.();
  return uid === undefined ? undefined : `/run/user/${uid}`;
}

function sentinelDecoratedDirUnderRegime(
  xdgRuntimeDir: string | undefined,
): string {
  return resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: "0",
    runtimeRoot: xdgRuntimeDir === undefined ? null : xdgRuntimeDir,
  }).dir;
}

function padiCandidatesUnderRegime(
  xdgRuntimeDir: string | undefined,
): PadiDaemon[] {
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
    if (!isPrivateOwnedDir(dir)) continue;
    const socket = join(dir, PADI_SOCK_FILE);
    if (!isSocketInode(socket)) continue;
    found.push({
      socket,
      stateRoot: readStateRootManifest(dir) ?? null,
      gatePid: gatePid(join(dir, PADI_GATE_FILE)) ?? null,
    });
  }
  return found;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

type RuntimeRegimes = readonly (string | undefined)[];

const POLL_REGIMES = (): RuntimeRegimes => [xdgRuntimeDirGuessForDiscovery()];

const DIAL_REGIMES = (): RuntimeRegimes => [
  xdgRuntimeDirGuessForDiscovery(),
  undefined,
];

/** Every running padi daemon discoverable on this host — the regime in force plus
 *  `extraRegimes`, de-duped by canonical socket path. Strictly read-only: it stats
 *  dirs and reads the gate file and the `state-root` manifest, but never dials,
 *  kills or reaps a daemon, and never throws (an unreadable root contributes
 *  nothing). */
export function discoverPadiDaemons(
  extraRegimes: RuntimeRegimes = POLL_REGIMES(),
): PadiDaemon[] {
  const regimes: RuntimeRegimes = [
    runtimeRegimeInForce() === "xdg" ? process.env.XDG_RUNTIME_DIR : undefined,
    ...extraRegimes,
  ];
  const byPath = new Map<string, PadiDaemon>();
  const scanned = new Set<string>();
  for (const xdgRuntimeDir of regimes) {
    if (scanned.has(xdgRuntimeDir ?? "")) continue;
    scanned.add(xdgRuntimeDir ?? "");
    for (const daemon of padiCandidatesUnderRegime(xdgRuntimeDir)) {
      const key = canonicalPath(daemon.socket);
      if (!byPath.has(key)) byPath.set(key, daemon);
    }
  }
  return [...byPath.values()];
}

/** The socket of a padi ALREADY serving `stateRoot`: matched on the resident's own
 *  `state-root` manifest (never a digest-path recompute) and gated on its `padi.pid`
 *  holder being alive, so a dead registration is ignored rather than returned.
 *  `undefined` when no live resident serves this root. */
export function residentPadiSocket(
  stateRoot: string,
  extraRegimes: RuntimeRegimes = DIAL_REGIMES(),
): string | undefined {
  const resolved = resolve(stateRoot);
  const discovered = discoverPadiDaemons(extraRegimes);
  return discovered.find(
    (d) => daemonServesStateRoot(d, resolved) && daemonIsLive(d),
  )?.socket;
}

function daemonServesStateRoot(
  d: PadiDaemon,
  resolvedStateRoot: string,
): boolean {
  return d.stateRoot !== null && resolve(d.stateRoot) === resolvedStateRoot;
}

function primaryPadiAmong(
  live: readonly PadiDaemon[],
  primaryStateRoot: string,
): PadiDaemon | undefined {
  const resolved = resolve(primaryStateRoot);
  return live.find((d) => daemonServesStateRoot(d, resolved));
}

function daemonIsLive(d: PadiDaemon): boolean {
  return d.gatePid !== null && isHolderLive(d.gatePid);
}

/** The outcome of resolving which running padi to dial, as STRUCTURE — never as a
 *  sentence. Every arm but `many` carries the socket to dial; `many` carries the
 *  running padis to choose between PLUS the state root this environment names and
 *  no daemon serves, because a refusal that cannot print that root cannot say what
 *  would have answered. {@link localPadiSocket} is the one place that turns the
 *  unaddressable arms into words. */
export type PadiSocketResolution =
  | {
      kind: "explicit" | "stateRoot" | "env" | "one" | "primary" | "none";
      socket: string;
    }
  | {
      kind: "many";
      runningPadis: readonly PadiDaemon[];
      unmatchedStateRoot: string;
    };

/** Resolve which running padi to dial: an explicit socket, an explicit state root,
 *  `$PADI_SOCKET`, else {@link classifyLivePadis} over every LIVE discovered daemon. */
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
  return classifyLivePadis(
    discoverPadiDaemons(DIAL_REGIMES()).filter(daemonIsLive),
  );
}

/** Classify the LIVE padi daemons as data: none → the socket this environment names;
 *  exactly one → that one; several → the daemon serving this environment's state root
 *  (`primary`), or `many` when none of them does. Pure over `live` — it makes no
 *  liveness judgement of its own. */
export function classifyLivePadis(
  live: readonly PadiDaemon[],
): PadiSocketResolution {
  if (live.length === 0) {
    return {
      kind: "none",
      socket: padiSocketPath(namePadiStateRootForDiscovery()),
    };
  }
  const sole = live.length === 1 ? live[0] : undefined;
  if (sole !== undefined) return { kind: "one", socket: sole.socket };
  const environmentStateRoot = namePadiStateRootForDiscovery();
  const primary = primaryPadiAmong(live, environmentStateRoot);
  return primary !== undefined
    ? { kind: "primary", socket: primary.socket }
    : {
        kind: "many",
        runningPadis: live,
        unmatchedStateRoot: environmentStateRoot,
      };
}

/** WHICH local padi a client means, as data: discover one (`auto`), a literal
 *  socket path, or a state root to derive one from. */
export type LocalPadiTarget =
  | { readonly kind: "auto" }
  | { readonly kind: "socket"; readonly path: string }
  | { readonly kind: "stateRoot"; readonly dir: string };

/** The socket a {@link LocalPadiTarget} names, or the sentence saying why no local
 *  padi can be addressed. */
export type LocalPadiSocket =
  | { readonly kind: "ok"; readonly socket: string }
  | { readonly kind: "unaddressable"; readonly message: string };

/** The two LOCAL endpoint flags, exactly as a face parses them off argv. */
export interface LocalPadiFlags {
  readonly socket: string | undefined;
  readonly stateRoot: string | undefined;
}

/** Parse the local endpoint flags into a {@link LocalPadiTarget}: a blank value or
 *  both flags at once is unaddressable (never a quiet fallback to discovery). */
export function localPadiTargetOf(flags: LocalPadiFlags):
  | { readonly kind: "ok"; readonly target: LocalPadiTarget }
  | {
      readonly kind: "unaddressable";
      readonly message: string;
    } {
  const given = [
    ["--socket", flags.socket],
    ["--state-root", flags.stateRoot],
  ] as const;
  const blank = given
    .filter(([, v]) => v !== undefined && v.trim() === "")
    .map(([name]) => name);
  if (blank.length > 0) {
    return {
      kind: "unaddressable",
      message: `${blank.join(" and ")} was passed with an empty value — an unset shell variable, most likely. Name a padi, or drop the flag entirely; kolu will not quietly fall back to whichever daemon it discovers.`,
    };
  }
  const named = given.filter(([, v]) => v !== undefined).map(([name]) => name);
  if (named.length > 1) {
    return {
      kind: "unaddressable",
      message: `${named.join(" and ")} are mutually exclusive — --socket is a literal socket path, --state-root derives one. Pass just one.`,
    };
  }
  if (flags.socket !== undefined) {
    return { kind: "ok", target: { kind: "socket", path: flags.socket } };
  }
  if (flags.stateRoot !== undefined) {
    return { kind: "ok", target: { kind: "stateRoot", dir: flags.stateRoot } };
  }
  return { kind: "ok", target: { kind: "auto" } };
}

/** Resolve a {@link LocalPadiTarget} to a socket, or to the one sentence a face
 *  prints when none can be addressed — the ONE place the unaddressable arms of
 *  {@link PadiSocketResolution} become words. */
export function localPadiSocket(target: LocalPadiTarget): LocalPadiSocket {
  const lookup = match<
    LocalPadiTarget,
    Parameters<typeof resolveRunningPadiSocket>[0]
  >(target)
    .with({ kind: "socket" }, ({ path }) => ({ socket: path }))
    .with({ kind: "stateRoot" }, ({ dir }) => ({ stateRoot: dir }))
    .with({ kind: "auto" }, () => ({}))
    .exhaustive();

  let resolved: PadiSocketResolution;
  try {
    resolved = resolveRunningPadiSocket(lookup);
  } catch (err) {
    return { kind: "unaddressable", message: messageOf(err) };
  }

  return match<PadiSocketResolution, LocalPadiSocket>(resolved)
    .with({ kind: "many" }, ({ runningPadis, unmatchedStateRoot }) => ({
      kind: "unaddressable",
      message: `several padi daemons are running on this host and none is keyed to this environment's state root (${unmatchedStateRoot}) — set $PADI_SOCKET, or pass --socket / --state-root, to pick one:\n${runningPadis
        .map(
          (c) =>
            `  PADI_SOCKET=${c.socket}    (${c.stateRoot ?? "unknown state-root"})`,
        )
        .join("\n")}`,
    }))
    .with({ kind: "none" }, () => ({
      kind: "unaddressable",
      message:
        "no running padi daemon found on this host — start kolu (its padi serves the terminals), or pass --socket / set $PADI_SOCKET.",
    }))
    .with(
      { kind: "explicit" },
      { kind: "stateRoot" },
      { kind: "env" },
      { kind: "one" },
      { kind: "primary" },
      ({ socket }) => ({ kind: "ok", socket }),
    )
    .exhaustive();
}

/** The state root THIS environment names — `$KOLU_PADI_STATE_DIR` when set, else
 *  the production formula. Read-only naming, never a bind. */
export function namePadiStateRootForDiscovery(): string {
  const env = process.env.KOLU_PADI_STATE_DIR;
  if (env !== undefined && env !== "") return resolve(env);
  return productionPadiStateRoot();
}
