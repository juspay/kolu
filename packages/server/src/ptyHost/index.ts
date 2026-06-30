/**
 * kolu-server's pty-host endpoint — the composition root for **the door** (B2).
 *
 * Before B2 this module constructed the pty-host IN-PROCESS at import time and
 * served it on a socket. Now the server is a *client* of a `kaval` daemon it
 * spawns: `ensureLocalEndpoint()` runs the always-recycle boot (kill any
 * survivor, spawn fresh, connect + handshake) through the supervisor spine
 * (`@kolu/surface-daemon-supervisor`), and `ptyHostClient` is a **stable
 * forwarding facade** over whatever connection the endpoint currently holds — so
 * `LocalTerminalEndpoint` keeps one import-time reference while the live socket
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
  type RestartSteps,
  serializeRestart,
} from "@kolu/surface-daemon-supervisor";
import {
  DEFAULT_MIRROR_SCROLLBACK,
  type PtyHostClient,
  type PtyHostIdentity,
  type PtyHostSpawnInput,
  type PtyHostSystemInfo,
} from "kaval";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { log } from "../log.ts";
import { connectKaval } from "./connect.ts";
import { setLocalSocketPath } from "./daemonStatus.ts";
import {
  kavalGatePath,
  kavalSocketPath,
  localKavalDriver,
} from "./localDriver.ts";

type Identity = PtyHostIdentity | undefined;

/** The single local kaval host's id — the daemon-status key the endpoint reports
 *  under and consumers (e.g. boot adoption's `setAdoptedCount`) read by. Owned
 *  here, where `ensureLocalEndpoint` defines the daemon's identity/lifecycle.
 *  This is a *daemon* identity (the kaval host), distinct from a terminal's
 *  `location` (a `HostLocation` DU in kolu-common); a terminal placed on the
 *  local endpoint carries `{ kind: "local" }`, not this string. */
export const LOCAL_HOST_ID = "local";

/** One pty-host daemon kolu is a client of: its supervised endpoint plus the
 *  serialized restart trigger bound to it. The trigger is held WITH the endpoint
 *  (not rebuilt per call) so its coalescing state is shared — concurrent restart
 *  requests ride one in-flight recycle. */
interface PtyHost {
  endpoint: Endpoint<PtyHostClient, Identity>;
  triggerRestart: <Ctx>(
    steps: RestartSteps<PtyHostClient, Identity, Ctx>,
  ) => Promise<void>;
}

/** The pty-host daemons kolu drives, keyed by daemon host id. One `"local"` entry
 *  today (`ensureLocalEndpoint`); F-REMOTE adds a `remote` entry per dialed kaval.
 *  A map (not a singleton) so the boot-adoption orchestration is host-keyed by
 *  construction — but PR-1 dials no remote, so the single local entry keeps every
 *  resolution byte-identical. */
const ptyHosts = new Map<string, PtyHost>();

/** The live socket client for `hostId`, or a thrown error if its endpoint isn't
 *  connected (before `ensureLocalEndpoint()`, or while the daemon is down —
 *  `degraded`). The facade resolves THIS on every call, so a reconnect (B3) is
 *  transparent to every holder. */
function liveClientFor(hostId: string): PtyHostClient {
  const conn = ptyHosts.get(hostId)?.endpoint.current();
  if (!conn) {
    throw new Error(
      `pty-host endpoint "${hostId}" is not connected — the kaval daemon is starting or down`,
    );
  }
  return conn.client;
}

/** Stable forwarding facades, one per host — memoized so a captured reference
 *  never goes stale across that host's daemon recycles (the facade resolves the
 *  live client at call time). */
const hostClientFacades = new Map<string, PtyHostClient>();

/** The stable pty-host client facade for `hostId` — forwards every call to that
 *  host's current daemon connection. The boot-adoption path resolves the host it
 *  reconciles through here; `ptyHostClient` below is the local one every
 *  in-process consumer already holds. */
export function hostPtyClient(hostId: string): PtyHostClient {
  const existing = hostClientFacades.get(hostId);
  if (existing) return existing;
  const facade = makeForwardingClient(() => liveClientFor(hostId));
  hostClientFacades.set(hostId, facade);
  return facade;
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

/** The pty-host client `LocalTerminalEndpoint` (and this module) consume — the
 *  LOCAL host's stable facade over its current daemon connection. The single host
 *  today; F-REMOTE reaches other hosts through `hostPtyClient(hostId)`. */
export const ptyHostClient: PtyHostClient = hostPtyClient(LOCAL_HOST_ID);

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
  /** Run after the boot ADOPTS a surviving daemon (B3.3) — reconcile its live
   *  PTYs against the saved session. Injected (not imported) so this composition
   *  root stays free of the terminal-endpoint layer, which imports back from
   *  here. Skipped on a fresh / recycled boot (no survivors to reconcile). */
  onAdopted?: () => Promise<void>;
  /** Run after the boot try/catch settles, REGARDLESS of outcome — NOT on
   *  connection. Even when the daemon came up `dead` this fires; the name says
   *  "boot settled," not "connected," precisely because there is no connection
   *  event to honor here. Used to start live inventory discovery (B3.5):
   *  subscribe to the daemon's `inventory` feed so a PTY created OUT-OF-BAND (a
   *  `kaval-tui create` against the same daemon) is adopted while kolu runs, not
   *  just at the next boot. Injected (not imported) for the same reason as
   *  `onAdopted`. Given a process-lifetime signal; the reconciler re-subscribes
   *  across daemon recycles until it aborts (and absorbs a dead-on-boot daemon
   *  the same way — it simply waits, then picks up once the daemon connects). */
  onBootSettled?: (signal: AbortSignal) => void;
}): Promise<void> {
  const socketPath = kavalSocketPath(opts.port);
  // Surface where this kaval listens, so the dialog can show it (and `kaval-tui`
  // users can target it explicitly). Set before the endpoint's first status emit.
  setLocalSocketPath(socketPath);
  const ep = createEndpoint<PtyHostClient, Identity>({
    hostId: LOCAL_HOST_ID,
    gatePath: kavalGatePath(socketPath),
    socketPath,
    driver: localKavalDriver(socketPath),
    connect: () => connectKaval(socketPath),
    log,
    onStatus: opts.onStatus,
  });
  ptyHosts.set(LOCAL_HOST_ID, {
    endpoint: ep,
    triggerRestart: serializeRestart(ep),
  });
  try {
    // The boot, B3.3: adopt-or-recycle. A surviving daemon (a redeploy that did
    // not change kaval's source) is ADOPTED — its PTYs preserved — and the
    // caller reconciles its live PTYs against the saved session via `onAdopted`.
    // A fresh / recycled boot has no survivors, so the saved session is left for
    // the existing restore-card path (B2-unchanged) and `onAdopted` is skipped.
    const adopted = await ep.adoptOrEnsure();
    if (adopted && opts.onAdopted) {
      try {
        await opts.onAdopted();
      } catch (err) {
        // Reconciliation failed AFTER we adopted the survivor's connection — the
        // daemon is connected but holds PTYs kolu may not have registered (F3).
        // Fail CLOSED: recycle the daemon (kill + spawn fresh) so those hidden
        // PTYs are destroyed and the user's saved session falls back to the
        // restore card, rather than leaving invisible live terminals behind it.
        log.error(
          { err },
          "surviving-session reconciliation failed — recycling the adopted daemon",
        );
        await ep.ensure();
      }
    }
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "kaval endpoint failed to come up at boot");
  }

  // Boot settled (success OR `dead`) — run whatever the caller hooked here. Used
  // to start live inventory discovery (B3.5), which runs whatever the boot
  // outcome: if the daemon is down, the reconciler's re-subscribe loop simply
  // waits and picks up once it connects; if a survivor was adopted above, its
  // snapshot is already-known terminals (idempotent no-ops). The signal is
  // process-lifetime — never aborted today (no shutdown hook; the per-terminal
  // taps live the same way), so the loop runs until the process ends and
  // survives daemon recycles.
  opts.onBootSettled?.(new AbortController().signal);
}

/** Run a serialized, session-preserving restart of the local kaval endpoint
 *  (B3.2). The caller (`restartLocal.ts`, the soul) supplies the restart steps —
 *  capture the session, drain the terminals, recycle, reattach — and this
 *  forwards them through the endpoint's coalescing + emit-guard trigger. Throws
 *  if the endpoint hasn't been booted yet (`ensureLocalEndpoint` not run). */
export function restartLocalEndpoint<Ctx>(
  steps: RestartSteps<PtyHostClient, Identity, Ctx>,
): Promise<void> {
  const host = ptyHosts.get(LOCAL_HOST_ID);
  if (!host) {
    throw new Error("kaval endpoint not initialized — cannot restart");
  }
  return host.triggerRestart(steps);
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
    // The per-terminal headless-mirror depth — kaval owns this number (the
    // mirror lives there), so we send its `DEFAULT_MIRROR_SCROLLBACK`, the SAME
    // value kaval-tui's spawn path falls back to. Deliberately smaller than the
    // client's visible scrollback (kolu-common's `DEFAULT_SCROLLBACK`): the
    // conflated 50K mirror × unbounded live terminals was the OOM. See
    // `docs/atlas/src/content/atlas/kaval-heap-oom.mdx`.
    scrollback: DEFAULT_MIRROR_SCROLLBACK,
  };
}

/** `composeSpawnInput` against the daemon's cached `system.info`. */
export async function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
}): Promise<PtyHostSpawnInput> {
  return composeSpawnInput(args, await hostInfo());
}
