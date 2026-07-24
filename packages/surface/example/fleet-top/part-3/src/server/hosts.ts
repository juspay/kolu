/**
 * Per-host binding — dial one box over ssh, mirror its `top` inward, and expose
 * an in-process link the surface-map forwards to.
 *
 * The three-hop mirror, explicit:
 *
 *   1. **Dial** — `makeSession({ connectOnce: sshConnector(...) })`. Per spawn,
 *      `sshConnector` nix-provisions the agent closure onto the host and runs
 *      `ssh <host> fleet-top-agent --stdio`, wiring stdio to a typed client.
 *   2. **Pump inward** — `pumpRemoteSurface` pins the session, loops over each
 *      successive client, and folds the agent's frames into a LOCAL surface
 *      implementation (`makeSink` writes through `runtime.ctx`). Rebuilt per
 *      spawn, so per-client state resets on reconnect.
 *   3. **Re-serve** — the local `implementSurface` runtime IS the browser-facing
 *      surface for this host; `directLink` over its flattened router is the
 *      `link` the map forwards calls to. `process.kill` forwards to the current
 *      live agent client (an imperative mutation has no local state to keep).
 */

import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { directLink } from "@kolu/surface/links/direct";
import {
  type AgentClient,
  directAgentDerivation,
  makeSession,
  pumpRemoteSurface,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import type { EntryConnectionState } from "@kolu/surface-map/server";
import type { HostFailure } from "../common/map";
import {
  DEFAULT_LOAD,
  DEFAULT_MEMORY,
  type Pid,
  type Process,
  surface,
} from "../common/surface";

export interface HostBinding {
  /** The in-process link the surface-map forwards member calls to. */
  link: unknown;
  /** This host's latest session state, projected for the map. */
  state(): EntryConnectionState<"copying", HostFailure>;
  /** Subscribe to session-state changes (for the registry's `subscribe`). */
  onStateChange(cb: () => void): () => void;
  destroy(): void;
}

/** Project the session's connection state onto the map's per-entry state. A
 *  copying/reconnecting window reads `warming` (in motion, self-heals); only a
 *  bounded remote fault reads `failed` (needs intervention) — an unreachable box
 *  stays `warming` and retries, it does not become `failed`. Readiness is
 *  LINK-liveness: a `connected` session projects to `connected` REGARDLESS of the
 *  offset, propagating the wall-clock offset `makeSession` measures off the reserved
 *  `system.clockNow` at admit. `clockOffset: null` is carried THROUGH (honest
 *  not-yet-measured; the reader renders "—"), never a fabricated `0` and never
 *  demoted to `connecting`. */
function projectState(
  s: SessionState<SshProv>,
): EntryConnectionState<"copying", HostFailure> {
  switch (s.phase) {
    case "probing":
    case "copying":
    case "building":
      return { kind: "copying" };
    case "connecting":
      return { kind: "connecting" };
    case "connected":
      // LINK-liveness readiness: connected either way; a null offset is carried
      // through (not-yet-measured), never demoted to `connecting`.
      return { kind: "connected", clockOffset: s.clockOffset };
    case "disconnected":
      // Transient — no domain failure attached, so it projects to `warming` (an
      // unreachable box self-heals; it does not become `failed`).
      return { kind: "disconnected" };
    case "failed":
      // A bounded terminal give-up — a failed entry must carry the schema-valid
      // domain failure it publishes.
      return { kind: "failed", failure: { reason: s.error } };
  }
}

export function buildHostBinding(host: string, agentDrv: string): HostBinding {
  // #region dial
  const session: Session<
    AgentClient<typeof surface.contract>,
    SshProv
  > = makeSession({
    initialConnection: "probing",
    connectOnce: sshConnector<typeof surface.contract>({
      host,
      binary: "fleet-top-agent",
      // Policy-free: the CONSUMER composes the localhost arm's spawn env, keeping only
      // the keys that are SET (an empty HOME/PATH would misdirect config/command lookup).
      // kolu uses kolu-pty's `composeSpawnEnv`; a standalone example picks inline. Never
      // the caller's ambient `process.env`; unused for a real ssh host.
      localEnv: Object.fromEntries(
        (["HOME", "PATH"] as const)
          .map((k): [string, string | undefined] => [k, process.env[k]])
          .filter((e): e is [string, string] => e[1] !== undefined),
      ),
      // Constant resolver — this demo takes the agent .drv from the environment.
      // A consumer that picks the .drv per host's nix-system passes an async
      // `resolveSystem(host)` probe here instead.
      resolveDrvPath: () => Promise.resolve(directAgentDerivation(agentDrv)),
    }),
    label: `host:${host}`,
  });
  // #endregion

  // The local surface implementation this host's browser subscribers read. The
  // pump folds the agent's frames into these stores/caches.
  const loadStore = inMemoryStore(DEFAULT_LOAD);
  const memoryStore = inMemoryStore(DEFAULT_MEMORY);
  const processes = new Map<Pid, Process>();

  const runtime = implementSurface(surface, {
    cells: {
      load: { store: loadStore },
      memory: { store: memoryStore },
    },
    collections: {
      processes: {
        readAll: () => processes,
        upsert: (key, value) => {
          processes.set(key, value);
        },
        remove: (key) => {
          processes.delete(key);
        },
      },
    },
    procedures: {
      process: {
        // `kill` forwards to the CURRENT live agent client — never a per-spawn
        // mirror stub, since a kill can land across a reconnect. Fails loudly in
        // a link gap.
        kill: async ({ input }) => {
          const pending = session.currentClient();
          if (pending === null)
            throw new Error("no live agent link — cannot kill");
          const client = await pending;
          return client.surface.process.kill(input);
        },
      },
    },
  });

  // Pump the agent's frames into the local runtime. `makeSink` is rebuilt per
  // spawn (state resets on reconnect); the first `load` frame is the handshake
  // that flips the session to `connected`.
  // #region pump
  let firstLoad = true;
  void pumpRemoteSurface({
    source: surface,
    session,
    makeSink: () => {
      firstLoad = true;
      return {
        cells: {
          load: (v) => {
            if (firstLoad) {
              firstLoad = false;
              session.markConnected();
            }
            runtime.ctx.cells.load.set(v);
          },
          memory: (v) => runtime.ctx.cells.memory.set(v),
        },
        collections: {
          processes: {
            upsert: (k, v) => runtime.ctx.collections.processes.upsert(k, v),
            remove: (k) => runtime.ctx.collections.processes.remove(k),
          },
        },
      };
    },
  });
  // #endregion

  // `implementSurface`'s `.router` is already the FINAL flattened router
  // (`/surface/…`) — no consumer re-finalizes it via oRPC `implement`. It's
  // typed `unknown`; cast at the `directLink` boundary.
  const router = runtime.router;
  const link = directLink<typeof surface.contract>(router as never);

  let latest: SessionState<SshProv> = {
    phase: "probing",
    log: [],
    sinceMs: 0,
    campaignEpoch: 0,
  };
  const unsub = session.onState((s) => {
    latest = s;
  });

  return {
    link,
    state: () => projectState(latest),
    onStateChange: (cb) => session.onState(() => cb()),
    destroy: () => {
      unsub();
      session.destroy();
    },
  };
}
