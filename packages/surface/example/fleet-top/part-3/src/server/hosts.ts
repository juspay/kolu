/**
 * Per-host binding — dial one box over ssh, mirror its `top` inward, and expose
 * an in-process DISPATCH the surface-map forwards to.
 *
 * The three-hop mirror, explicit:
 *
 *   1. **Dial** — `makeSession({ connectOnce: sshConnector(...) })`. Per spawn,
 *      `sshConnector` nix-provisions the agent closure onto the host and runs
 *      `ssh <host> fleet-top-agent --stdio`, wiring stdio to a member face over
 *      the agent's own surface.
 *   2. **Pump inward** — `pumpRemoteSurface` pins the session, loops over each
 *      successive client, and folds the agent's frames into a LOCAL surface
 *      implementation (`makeSink` writes through `runtime.ctx`). Rebuilt per
 *      spawn, so per-client state resets on reconnect.
 *   3. **Re-serve** — the local `implementSurface` runtime IS the browser-facing
 *      surface for this host; `directDispatch` over its handler record is the
 *      `dispatch` the map forwards calls to. `process.kill` forwards to the
 *      current live agent client (an imperative mutation has no local state to
 *      keep).
 */

import type { UnaryEffect } from "@kolu/surface/client";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import type { EntryConnectionState } from "@kolu/surface-map/server";
import {
  type AgentClient,
  agentBinaryCache,
  directAgentDerivation,
  makeSession,
  pumpRemoteSurface,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import { Effect } from "effect";
import { match, P } from "ts-pattern";
import type { HostFailure } from "../common/map";
import {
  DEFAULT_LOAD,
  DEFAULT_MEMORY,
  type KillArgs,
  type KillResult,
  type Pid,
  type Process,
  surface,
} from "../common/surface";

export interface HostBinding {
  /** The in-process dispatch the surface-map forwards member calls to. */
  dispatch: SurfaceDispatch;
  /** This host's latest session state, projected for the map. */
  state(): EntryConnectionState<"copying", HostFailure>;
  /** Subscribe to session-state changes (for the registry's `subscribe`). */
  onStateChange(cb: () => void): () => void;
  destroy(): void;
}

/** Project the session's connection state onto the map's per-entry state. A
 *  provisioning/reconnecting window reads `warming` (in motion, self-heals); only a
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
  return match(s)
    .with({ phase: P.union("probing", "provisioning") }, () => ({
      kind: "copying" as const,
    }))
    .with({ phase: "connecting" }, () => ({ kind: "connecting" as const }))
    .with({ phase: "connected" }, (connected) => ({
      // LINK-liveness readiness: connected either way; a null offset is carried
      // through (not-yet-measured), never demoted to `connecting`.
      kind: "connected" as const,
      clockOffset: connected.clockOffset,
    }))
    .with({ phase: "disconnected" }, () => ({
      // Transient — no domain failure attached, so it projects to `warming` (an
      // unreachable box self-heals; it does not become `failed`).
      kind: "disconnected" as const,
    }))
    .with({ phase: "failed" }, (failed) => ({
      // A bounded terminal give-up — a failed entry must carry the schema-valid
      // domain failure it publishes, AND that failure's evidence: the session's own
      // retained log tail off this same frame, so the reason and the output that
      // produced it travel together (they survive the client's liveness floor as one
      // record, unlike the live `connection` word).
      kind: "failed" as const,
      failure: { reason: failed.error },
      evidence: failed.log,
    }))
    .exhaustive();
}

/** Where provisioning may PREFETCH this agent's binaries from — REQUIRED on
 *  every derivation, since a cache-blind provisioning path is unspellable.
 *
 *  A real deployment does NOT hand-write this: `mkProvenAgentSource` bakes the
 *  declaration into the agent source from the flake's own `nixConfig`, and
 *  `readBakedBinaryCache(source)` hands back exactly that — so the TypeScript
 *  and the Nix cannot disagree about where the binaries are. This tutorial
 *  takes a bare `.drv` from the environment rather than a baked source, so it
 *  states one inline: ONCE, and against a RESERVED-INVALID host (RFC 2606) so
 *  the placeholder can never read as a real endpoint. */
const EXAMPLE_BINARY_CACHE = agentBinaryCache({
  substituters: ["https://cache.test.invalid/fleet-top"],
  trustedPublicKeys: ["fleet-top:0000000000000000000000000000000000000000000="],
});

export function buildHostBinding(host: string, agentDrv: string): HostBinding {
  // #region dial
  // `AgentClient` is the structural member face — there is no contract type to
  // be generic over any more, and the connector takes the SURFACE as a VALUE:
  // Effect RPC builds its client from `surface.group` and the face is re-nested
  // from `surface.spec`, neither of which is recoverable from a type alone.
  const session: Session<AgentClient, SshProv> = makeSession({
    initialConnection: "probing",
    connectOnce: sshConnector({
      surface,
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
      // Constant resolver — this demo takes the already-selected agent .drv from
      // the environment. Source-based consumers call `ctx.resolveAgentDrv`
      // instead; the connector owns system selection and evaluation policy.
      resolveDrvPath: () =>
        Promise.resolve(directAgentDerivation(agentDrv, EXAMPLE_BINARY_CACHE)),
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
        // mirror stub, since a kill can land across a reconnect. `Effect.promise`,
        // not `tryPromise`: this procedure declares no error channel, so a link
        // gap is an UNDECLARED failure and must stay a loud defect rather than
        // something a browser could narrow on and quietly handle.
        kill: ({ input }) =>
          Effect.gen(function* () {
            const pending = session.currentClient();
            if (pending === null)
              throw new Error("no live agent link — cannot kill");
            // The SESSION hands back a Promise (its reconnect machinery is
            // Promise-shaped); the member call it yields is an Effect, so the
            // lift stops at the session and the call composes.
            const client = yield* Effect.promise(() => pending);
            const kill = client.surface.process?.kill as UnaryEffect<
              KillArgs,
              KillResult,
              never
            >;
            // The re-serving surface declares no error for this member, so an
            // upstream transport failure is UNDECLARED here and crosses as a
            // defect rather than being smuggled into a `never` channel.
            return yield* Effect.orDie(kill(input));
          }),
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

  // `directDispatch` takes the served surface itself (anything carrying
  // `handlers`) and calls its handlers in-process — zero serialization, and the
  // map never learns whether the dispatch it forwards to crosses a wire.
  const dispatch = directDispatch(runtime);

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
    dispatch,
    state: () => projectState(latest),
    onStateChange: (cb) => session.onState(() => cb()),
    destroy: () => {
      unsub();
      session.destroy();
    },
  };
}
