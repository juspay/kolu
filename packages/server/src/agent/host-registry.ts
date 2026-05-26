/**
 * Per-host `HostSession` registry. Phase 2a of kolu#951.
 *
 * One singleton `HostSession` per host alias — every remote terminal,
 * git watcher, and code-tab subscription targeted at the same host
 * shares the same ssh subprocess. Lazy: the session is constructed
 * (and the agent installed via `AgentBootstrap`) on first request,
 * then cached.
 *
 * Consumers (`meta/git.ts`, `terminals.ts`, future `meta/github.ts`)
 * receive a `HostSessionLike` from `getReadySession()` — the registry
 * bakes in defer-until-ready around `call` and `subscribe`, so the
 * per-domain provider implementations don't each hand-roll the same
 * queue-then-replay wrapper.
 *
 * Phase 2a deliberately does NOT release a session when the last
 * terminal for a host closes — keeping the ssh connection warm
 * amortises the connect cost for the next "New terminal on srid-box"
 * click. A future cleanup pass can add an idle TTL.
 */

import type { HostSessionLike } from "kolu-remote-client";
import type { Logger } from "kolu-shared";
import { ensureAgent } from "./bootstrap.ts";
import { HostSession } from "./host-session.ts";

interface CachedSession {
  /** Resolves to the live `HostSession` once `ensureAgent` + `connect`
   *  complete. Callers go through `getReadySession()` which wraps this
   *  in a defer-until-ready `HostSessionLike`, so they never see the
   *  raw `ready` promise. */
  ready: Promise<HostSession>;
  /** Cached `HostSessionLike` wrapper — built once on first lookup so
   *  every caller for the same host shares the same wrapper identity
   *  (matters for downstream consumers that key off reference equality). */
  ready_wrapper: HostSessionLike;
}

const sessions = new Map<string, CachedSession>();

/** Get (or lazily build) a `HostSessionLike` for the given host. The
 *  returned object queues `call` / `subscribe` until the underlying
 *  `HostSession` is connected, then flushes through transparently.
 *  Callers never await a ready-promise. */
export function getReadySession(host: string, log: Logger): HostSessionLike {
  const existing = sessions.get(host);
  if (existing) return existing.ready_wrapper;

  const ready = (async () => {
    const { remoteAgentPath } = await ensureAgent(host, log);
    const session = new HostSession({ host, remoteAgentPath, log });
    await session.connect();
    return session;
  })();

  const wrapper = makeReadyGatedSession(ready);
  sessions.set(host, { ready, ready_wrapper: wrapper });
  return wrapper;
}

/** Tear down the session for `host` (if any) — used by the disconnect
 *  modal's Reconnect action. */
export async function closeHostSession(host: string): Promise<void> {
  const cached = sessions.get(host);
  if (!cached) return;
  sessions.delete(host);
  try {
    const session = await cached.ready;
    await session.close();
  } catch {
    // best-effort
  }
}

/** Build a `HostSessionLike` that queues `call`/`subscribe` invocations
 *  until the underlying `HostSession` is connected. Subscription
 *  tokens are returned synchronously (queue `update` calls; honor
 *  early `close()` with a `closed` guard that prevents the deferred
 *  subscribe from issuing post-close). */
function makeReadyGatedSession(ready: Promise<HostSession>): HostSessionLike {
  return {
    call: async (method, args) => {
      const session = await ready;
      return session.call(method, args);
    },
    subscribe: (method, args, onEvent) => {
      let inner: ReturnType<HostSession["subscribe"]> | null = null;
      const queuedUpdates: unknown[] = [];
      let closed = false;
      void ready.then((session) => {
        if (closed) return;
        inner = session.subscribe(method, args, onEvent);
        for (const params of queuedUpdates) void inner.update(params);
      });
      return {
        update: async (params) => {
          if (inner) await inner.update(params);
          else queuedUpdates.push(params);
        },
        close: async () => {
          closed = true;
          if (inner) await inner.close();
        },
      };
    },
  };
}
