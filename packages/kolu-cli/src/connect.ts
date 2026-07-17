/**
 * kolu-cli's LOCAL padi dial — the connect layer the CLI faces (`kolu mcp`,
 * later `kolu tui`) share, owned by the composition root: resolve the running
 * padi's digest-keyed socket, dial it through the shared `@kolu/padi/dial` kit
 * (control-core handshake + the typed compatibility gate), scope to the padi
 * sibling, and mount `STREAM_RETRY` — the ONE surfaceClient both faces ride.
 * The remote `--host` dial lives in `hostConnect.ts`; both return the same
 * `KoluCliConnection` shape so a face is transport-blind.
 *
 * Re-invoked per (re)dial by the MCP adapter, which is the restart
 * discipline's redial hook: `resolveRunningPadiSocket` runs FRESH each call.
 * padi's socket path is keyed by a digest of its STATE-ROOT (`padiDigest`),
 * not its build — a padi that respawns at the same state-root listens at the
 * SAME path across a restart/upgrade. So the fresh re-resolve is for
 * robustness (it re-discovers the running daemon and drops a dead
 * registration via the liveness gate, rather than pinning a cached path), and
 * `connectPadi`'s hello/compat gate is what proves the redialed generation
 * speaks our contract — never retry-same-path-blind.
 */

import {
  connectPadi,
  type PadiSurfaceClient,
  resolveRunningPadiSocket,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { padiSurface } from "@kolu/padi/surface";
import { STREAM_RETRY } from "@kolu/surface/client";

/** The transport-blind handle a CLI face is written against — the scoped,
 *  retry-mounted client plus a `dispose` that drops the socket/pipe. */
export interface KoluCliConnection {
  client: PadiSurfaceClient;
  dispose: () => void;
}

// The streaming member keys of padiSurface — cells/collections/streams/events,
// whose `get`/`keys` verbs open snapshot-then-delta subscriptions. Derived from
// the spec (the existing source of truth), never hand-listed, so a new member
// inherits the retry mount by construction.
const STREAMING_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(padiSurface.spec.cells ?? {}),
  ...Object.keys(padiSurface.spec.collections ?? {}),
  ...Object.keys(padiSurface.spec.streams ?? {}),
  ...Object.keys(padiSurface.spec.events ?? {}),
]);

// ONLY the subscription verbs. A merged member (`session` is a cell AND a
// procedure namespace on one wire node) must never see its PROCEDURES wrapped:
// retrying a mutation forever against a new daemon generation is exactly the
// two-clocks bug the restart discipline exists to prevent — mutations stay
// no-retry (the stdio link's factory default), streams retry.
const STREAMING_VERBS: ReadonlySet<string> = new Set(["get", "keys"]);

/**
 * Mount the production retry policy on a scoped padi client: every streaming
 * `get`/`keys` call carries `STREAM_RETRY` context unless the call site
 * supplies its own — so a mid-stream transport blip transparently
 * re-subscribes and the fresh snapshot re-seeds (the #1827 lesson: a raw
 * client without the plugin flakes on attach-vs-reconnect races production
 * consumers survive). A permanently-dead transport still rejects — the retry
 * fence (`shouldNotRetryORPCError`) refuses dead-transport codes — which is
 * what hands the MCP adapter its redial cue.
 *
 * Lazy proxies, not an eager walk: an oRPC client mints its procedure leaves
 * on property access (nothing to enumerate), so the wrap intercepts the same
 * way.
 */
export function mountStreamRetry(client: PadiSurfaceClient): PadiSurfaceClient {
  const surface = new Proxy(client.surface as object, {
    get(target, key, receiver) {
      const node = Reflect.get(target, key, receiver);
      if (
        typeof key !== "string" ||
        !STREAMING_KEYS.has(key) ||
        node === null ||
        (typeof node !== "object" && typeof node !== "function")
      ) {
        return node;
      }
      return new Proxy(node as object, {
        get(nodeTarget, verb, nodeReceiver) {
          const value = Reflect.get(nodeTarget, verb, nodeReceiver);
          if (
            typeof value !== "function" ||
            typeof verb !== "string" ||
            !STREAMING_VERBS.has(verb)
          ) {
            return value;
          }
          // Invoke the leaf DIRECTLY — never `value.call(...)`: an oRPC leaf
          // is itself a callable path-proxy whose property access mints
          // SUBPATHS, so `.call` would dispatch the RPC at `<verb>/call` (a
          // 404), not bind `this`.
          const leaf = value as (i: unknown, o: unknown) => unknown;
          return (
            input: unknown,
            opts?: { signal?: AbortSignal; context?: unknown },
          ) =>
            leaf(input, {
              ...opts,
              context: opts?.context ?? STREAM_RETRY,
            });
        },
      });
    },
  });
  return { ...client, surface } as PadiSurfaceClient;
}

/**
 * Dial the LOCAL padi: resolve the running daemon's socket fresh (digest-keyed
 * — see the module header), dial + handshake through `connectPadi` (a contract
 * skew fails LOUD with `DaemonContractSkewError`), scope, mount retry.
 *
 * Fail-fast on the resolution edges — the CLI faces dial a padi that ALREADY
 * runs, never provision one:
 *   - no daemon discovered → a named error naming the fix (start kolu / set
 *     `$PADI_SOCKET`), not a doomed dial against the default path;
 *   - more than one → a named error listing each candidate socket.
 */
export async function connectKoluCliLocal(): Promise<KoluCliConnection> {
  const resolved = resolveRunningPadiSocket();
  if (resolved.kind === "many") {
    const lines = resolved.candidates
      .map((c) => `  PADI_SOCKET=${c.socket}`)
      .join("\n");
    throw new Error(
      `more than one padi daemon is running on this host — set $PADI_SOCKET to pick one:\n${lines}`,
    );
  }
  if (resolved.kind === "none") {
    throw new Error(
      "no running padi daemon found on this host — start kolu (its padi serves the terminals), or set $PADI_SOCKET to an explicit socket.",
    );
  }
  const conn = await connectPadi(resolved.socket);
  return {
    client: mountStreamRetry(scopePadiSurface(conn.client)),
    dispose: conn.dispose,
  };
}
