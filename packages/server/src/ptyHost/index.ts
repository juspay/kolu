/**
 * kolu-server's pty-host endpoint — the composition root for **the door** (B2).
 *
 * Before B2 this module constructed the pty-host IN-PROCESS at import time and
 * served it on a socket. Now the server is a *client* of a `kaval` daemon it
 * spawns: `ensureLocalEndpoint()` runs the always-recycle boot (kill any
 * survivor, spawn fresh, connect + handshake) through the supervisor spine
 * (`@kolu/surface-daemon-supervisor`), and `ptyHostClient` is a **stable
 * forwarding facade** over whatever connection the endpoint currently holds — so
 * `LocalTerminalBackend` keeps one import-time reference while the live socket
 * client is established asynchronously (no module-global host, no import-time
 * RPC). The spawn *policy* stays here, kolu's soul: `buildTerminalSpawnInput`
 * composes the env/identity/rcfile layers against the daemon's `system.info`,
 * exactly as before — only now over the wire.
 *
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B2 — the door).
 */

import {
  createEndpoint,
  type Endpoint,
  type EndpointStatus,
} from "@kolu/surface-daemon-supervisor";
import type {
  PtyHostClient,
  PtyHostIdentity,
  PtyHostSpawnInput,
  PtyHostSystemInfo,
} from "kaval";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { log } from "../log.ts";
import { connectKaval } from "./connect.ts";
import {
  kavalGatePath,
  kavalSocketPath,
  localKavalDriver,
} from "./localDriver.ts";

type Identity = PtyHostIdentity | undefined;

let endpoint: Endpoint<PtyHostClient, Identity> | undefined;

/** The live socket client, or a thrown error if the endpoint isn't connected
 *  (before `ensureLocalEndpoint()`, or while the daemon is down — `degraded`).
 *  The facade resolves THIS on every call, so a reconnect (B3) is transparent
 *  to every holder. */
function liveClient(): PtyHostClient {
  const conn = endpoint?.current();
  if (!conn) {
    throw new Error(
      "pty-host endpoint is not connected — the kaval daemon is starting or down",
    );
  }
  return conn.client;
}

/** Build a stable object that forwards every nested call to whatever the
 *  endpoint's current connection is. `ptyHostClient.surface.terminal.spawn(x)`
 *  resolves the live client at call time, so a captured reference never goes
 *  stale across a daemon recycle. Symbols (e.g. an accidental `await`) resolve
 *  to undefined so the facade is never mistaken for a thenable. */
function makeForwardingClient(getRoot: () => PtyHostClient): PtyHostClient {
  const build = (path: PropertyKey[]): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        return build([...path, prop]);
      },
      apply(_t, _thisArg, args) {
        const leaf = path[path.length - 1];
        if (leaf === undefined) {
          throw new Error("pty-host client facade invoked as a value");
        }
        // Walk to the leaf's parent on the LIVE client, then call it with the
        // parent as `this` (oRPC namespaces are plain nested objects).
        // biome-ignore lint/suspicious/noExplicitAny: dynamic forward over the contract client shape.
        let parent: any = getRoot();
        for (const key of path.slice(0, -1))
          parent = parent[key as PropertyKey];
        return parent[leaf](...args);
      },
    });
  return build([]) as PtyHostClient;
}

/** The pty-host client `LocalTerminalBackend` (and this module) consume — a
 *  stable facade over the endpoint's current daemon connection. */
export const ptyHostClient: PtyHostClient = makeForwardingClient(liveClient);

/** The connected daemon's self-declared identity (staleKey + navigableCommit),
 *  or undefined before connect / while down. Read at the surface's `buildInfo`
 *  time for the rail's commit + closure-hash column. */
export function currentPtyHostIdentity(): PtyHostIdentity | undefined {
  return endpoint?.current()?.identity;
}

/** The local daemon's endpoint, for the boot reconciliation and the supervised
 *  `daemon.restart` RPC (both in `reattach.ts`, kept out of this module to avoid
 *  a `ptyHost ↔ terminalBackend` import cycle). Undefined before
 *  `ensureLocalEndpoint`. */
export function getLocalEndpoint():
  | Endpoint<PtyHostClient, Identity>
  | undefined {
  return endpoint;
}

/** Reset the cached `system.info` so the NEXT spawn re-reads host facts from the
 *  daemon currently connected — called after a supervised restart reconnects to a
 *  freshly-spawned daemon. For a local recycle the host facts are stable, so this
 *  is cheap insurance that discharges B0's "revisit when connections become real"
 *  note; it becomes load-bearing once a respawn can target a different host (R-2). */
export function resetHostInfoCache(): void {
  infoPromise = undefined;
}

/** The kaval build id baked into the on-disk `KOLU_KAVAL_BIN` closure the running
 *  server points at — the server's EXPECTED daemon build. The currency check is
 *  `connectedDaemon.identity.staleKey !== this`: a survivor a build behind (only
 *  reachable once B3 adopts one across a deploy) is "update pending". Empty when
 *  the env var is unset (dev, no nix wrapper), which the client reads as "no
 *  update check available". */
export function expectedKavalBuildId(): string {
  return process.env.KAVAL_BUILD_ID ?? "";
}

/** Boot the local pty-host endpoint under the always-recycle policy and connect.
 *  Resolves whether or not the daemon came up — a boot failure reports `dead`
 *  via `onStatus` and leaves `ptyHostClient` throwing, so the server can still
 *  listen and the UI honestly shows the dead/degraded state (never a crash, never
 *  an import-time throw). */
export async function ensureLocalEndpoint(opts: {
  /** This server's HTTP listen port — namespaces the kaval socket per instance
   *  (`kaval-<port>`), so a second kolu-server never recycles this one's daemon. */
  port: number;
  onStatus: (hostId: string, status: EndpointStatus<Identity>) => void;
}): Promise<void> {
  const socketPath = kavalSocketPath(opts.port);
  const ep = createEndpoint<PtyHostClient, Identity>({
    hostId: "local",
    gatePath: kavalGatePath(socketPath),
    socketPath,
    driver: localKavalDriver(socketPath),
    connect: () => connectKaval(socketPath),
    log,
    onStatus: opts.onStatus,
  });
  endpoint = ep;
  try {
    // B3 survival boot: adopt a live, compatible survivor (keeping its PTYs
    // across a server-only redeploy) or recycle an absent/dead/skewed one. The
    // session reconciliation that follows — adopt the survivors, restore-card the
    // rest, reap orphans — runs in `reattach.ts` (called by the server entry
    // after this resolves), kept out of this module to avoid a
    // `ptyHost ↔ terminalBackend` import cycle.
    await ep.adoptOrEnsure();
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "kaval endpoint failed to come up at boot");
  }
}

// ── Spawn policy (kolu's soul) — unchanged from the in-process inversion,
//    only now composed against the DAEMON's system.info over the wire ─────────

/** Host facts (shell, home, platform, rcDir) read once per process and cached —
 *  constant for the daemon's life. The promise is cached (not its value) so
 *  concurrent first spawns share a single round-trip. */
let infoPromise: Promise<PtyHostSystemInfo> | undefined;
function hostInfo(): Promise<PtyHostSystemInfo> {
  infoPromise ??= ptyHostClient.surface.system.info({});
  return infoPromise;
}

/**
 * Compose the fully-specified spawn input the pty-host wire expects, from kolu's
 * spawn policy applied against the host's facts. Pure (no IO): the env is
 * layered least → most authoritative —
 *   1. `cleanEnv()`        — parent env passthrough (Nix devshell filter).
 *   2. `koluIdentityEnv()` — kolu's identity vars (stomp parent).
 *   3. `plan.env`          — per-PTY overrides (e.g. ZDOTDIR for zsh).
 *
 * **Local-host only, today.** The host this process talks to IS this machine, so
 * `cleanEnv()`'s `env.SHELL`/`env.HOME` (describing *this* machine) win, and
 * `system.info`'s shell/home are the fallback when the local env omits them
 * (e.g. systemd user services). `system.info.rcDir` (the host-side init-file
 * dir) is consumed unconditionally — the host owns that disk. A remote host
 * (R-2) must invert this `cleanEnv()`-wins layering; until then, local-only.
 */
export function composeSpawnInput(
  args: { id: string; cwd?: string },
  info: PtyHostSystemInfo,
): PtyHostSpawnInput {
  const env = cleanEnv();
  const shell = env.SHELL ?? info.shell;
  const home = env.HOME ?? info.home;
  const cwd = args.cwd || home || "/";
  Object.assign(env, koluIdentityEnv(pkg.version));
  const plan = prepareShellInit({
    shell,
    home,
    terminalId: args.id,
    rcDir: info.rcDir,
  });
  Object.assign(env, plan.env);
  return {
    id: args.id,
    argv: [shell, ...plan.args],
    cwd,
    env,
    initFiles: plan.initFiles,
    scrollback: DEFAULT_SCROLLBACK,
  };
}

/** `composeSpawnInput` against the daemon's cached `system.info`. */
export async function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
}): Promise<PtyHostSpawnInput> {
  return composeSpawnInput(args, await hostInfo());
}
