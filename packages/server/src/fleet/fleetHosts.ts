/**
 * kolu-server's implementation of the fleet face's `FleetHosts` port — the
 * host map as the MCP face sees it: which hosts exist, what they are called,
 * whether each is reachable, and one padi client per host.
 *
 * THE CLIENT IS THE IN-PROCESS MIRROR, not a second subscription.
 *
 * Each host already has a `PadiSession` (one link, local or over ssh) and a
 * re-serve mirroring `padiSurface` over it — the thing the browser reads at
 * `/surface/padi/*`. Two ways to hand the fleet face a client were available:
 * build a face over the session's own dispatch (`session.currentDispatch()`),
 * or build one over the mirror's bound handlers. This takes the MIRROR, for
 * the reason the memory sampler already takes it (`reServedPadiClient` in
 * `index.ts`): the session's dispatch is the WIRE, so every stream the face
 * opened — the terminals collection, urgency, each watch — would be a second
 * upstream subscription travelling the ssh link beside the browser's, doubling
 * a remote host's traffic and giving the agent and the browser two separately
 * folded views of one truth. The mirror has already paid for exactly those
 * subscriptions once and fans them out locally; reading through it means the
 * agent sees the same frames the operator does, with no socket or ssh hop.
 *
 * It also inherits the mirror's reconnect discipline for free: a padi that
 * restarts is re-dialled by the session and re-folded by the mirror, and the
 * face on top never knew.
 *
 * REFUSAL IS THE CALLER'S. This port answers `null` for a host that is not
 * connected and reports its `state`; the fleet face is what turns that into a
 * named refusal. A port that invented an empty answer here would be the
 * fallback the repo's rules forbid.
 */

import { padiClientOver, type PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { padiSurface } from "@kolu/padi-client/surface";
import { directDispatch } from "@kolu/surface/links/direct";
import type { RemotePool, ReServedSurface } from "@kolu/surface-remote";
import { decodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { FleetHosts } from "kolu-mcp";
import type { PadiSession } from "../padi/padiSession.ts";

/** The three words the fleet's `hosts` resource publishes. */
type FleetHostState = "warming" | "connected" | "failed";

/** Fold a session's connection frame to the fleet's coarse word. `connected`
 *  is honest liveness (`currentState().phase`, the session's own rule); a
 *  give-up (`failed`) and an `absent` far end are both FAILED — the agent can
 *  do nothing with either and the difference belongs to the host-map entry the
 *  operator reads, not to a tool roster. Every dialing/provisioning phase is
 *  `warming`: it is a host that is coming, so a tool that names it should wait
 *  rather than be told the host is broken. A DESTROYED session (the host is
 *  being torn out) is failed whatever its last frame said. */
function fleetStateOf(session: PadiSession): FleetHostState {
  if (session.isDestroyed()) return "failed";
  const phase = session.currentState().phase;
  if (phase === "connected") return "connected";
  if (phase === "failed" || phase === "absent") return "failed";
  return "warming";
}

export interface FleetHostsOptions {
  /** The warm padi pool — the ONE source of truth for membership. */
  pool: RemotePool<PadiSession, undefined>;
  /** The composition root's cached per-host re-serve (`reServeFor`). Passed in
   *  rather than built here: `index.ts` owns that cache, its eviction on host
   *  departure, and the pump-fault disposition for each host — a second cache
   *  would be a second lifetime for one mirror. */
  reServeFor: (
    host: HostKey,
    session: PadiSession,
  ) => ReServedSurface<typeof padiSurface.spec>;
  /** What this machine is called, for the local host's display name — the same
   *  reading the host tab shows (`hostDisplayName`: the local machine by its
   *  hostname, a remote by its ssh target), so a fleet line never says "local"
   *  at an agent that is holding three hosts at once. */
  localName: string;
}

/** Build the port. Holds no state of its own beyond the per-mirror client
 *  cache — every question is answered off the live pool at the instant it is
 *  asked, because the roster CHANGES under the conversation. */
export function fleetHostsOver(opts: FleetHostsOptions): FleetHosts {
  const { pool, reServeFor, localName } = opts;

  /** One `PadiSurfaceClient` per MIRROR, keyed by the mirror itself — not by
   *  host key. A host that leaves and returns gets a FRESH re-serve (the
   *  eviction in `index.ts`), and a cache keyed by the string would hand the
   *  fleet face the dead one's handlers forever. Keyed by the mirror, a new
   *  mirror simply misses. Weak, so an evicted mirror's client is collectable
   *  with it. */
  const clients = new WeakMap<
    ReServedSurface<typeof padiSurface.spec>,
    PadiSurfaceClient
  >();

  return {
    // Insertion order, and the pool's first member is the unremovable local
    // default (`index.ts` always seeds it at `seed[0]`), so "local first" is
    // the pool's own ordering rather than a sort this file re-asserts.
    keys: () => pool.hosts(),

    display: (key) => {
      const host = decodeHostKey(key);
      return host.kind === "local" ? localName : host.target;
    },

    padi: (key) => {
      const session = pool.getSession(key);
      // An unknown host and a down host are the same answer HERE — the caller
      // asks `state(key)` for which it is, and gets a sentence naming it.
      if (session === undefined) return null;
      if (fleetStateOf(session) !== "connected") return null;
      const mirror = reServeFor(decodeHostKey(key), session);
      const cached = clients.get(mirror);
      if (cached !== undefined) return cached;
      // `padiClientOver` over the mirror's handlers: the SAME face a dialed
      // padi gives, built by the same walk over the same wire tags
      // (`surface/padi/*` — what the re-serve binds), so nothing here casts a
      // client into existence. `.padi` is the surface face; the control core
      // on that value is not mirrored and nothing in the fleet face reaches
      // for it.
      const client = padiClientOver(directDispatch(mirror)).padi;
      clients.set(mirror, client);
      return client;
    },

    state: (key) => {
      const session = pool.getSession(key);
      // A host nobody is holding a session for cannot be warming toward
      // anything — it is not in the fleet, and `failed` is the honest word for
      // a key the caller named that this map cannot reach.
      return session === undefined ? "failed" : fleetStateOf(session);
    },

    subscribe: (cb) => {
      // TWO axes, one callback. `pool.subscribe` fires on MEMBERSHIP only (add
      // / remove / retire); REACHABILITY moves inside a session that never
      // leaves the pool, and a fleet that only republished on membership would
      // leave an agent reading `warming` for a host that came up minutes ago.
      // So this also watches every member's `onState`.
      //
      // Notification is EDGE-TRIGGERED on the coarse word: `onState` is
      // snapshot-then-delta (it fires synchronously on subscribe) and a single
      // dial walks several phases that all fold to `warming`. Firing `cb` per
      // frame would republish the whole roster a dozen times per reconnect and
      // once per host at startup for nothing. Comparing against the word last
      // reported makes every call `cb` sees a real move.
      const lastWord = new Map<string, FleetHostState>();
      const perHost = new Map<string, () => void>();

      /** READ the fleet and report whether anything moved since the last
       *  read: a host left, or a host's word changed. Pure observation — it
       *  attaches to nothing, which is what makes it safe to run from inside a
       *  listener. */
      const fold = (): boolean => {
        let moved = false;
        const live = new Set(pool.hosts());
        for (const [key, off] of perHost) {
          if (live.has(key)) continue;
          off();
          perHost.delete(key);
          lastWord.delete(key);
          moved = true;
        }
        for (const key of live) {
          const session = pool.getSession(key);
          if (session === undefined) continue;
          const word = fleetStateOf(session);
          if (lastWord.get(key) === word) continue;
          lastWord.set(key, word);
          moved = true;
        }
        return moved;
      };

      /** Listen to every member that is not yet listened to. SEPARATE from
       *  `fold`, and that separation is the whole trick: `onState` fires its
       *  snapshot frame synchronously from inside the attach, so a function
       *  that both attached and reported would re-enter itself mid-loop and
       *  report every host it had not reached yet as newly moved — waking the
       *  caller once per host at startup, for nothing. Attaching happens after
       *  the words are already folded, so each snapshot folds to "no move". */
      const attach = (): void => {
        for (const key of pool.hosts()) {
          if (perHost.has(key)) continue;
          const session = pool.getSession(key);
          if (session === undefined) continue;
          perHost.set(
            key,
            session.onState(() => {
              if (fold()) cb();
            }),
          );
        }
      };

      fold();
      attach();
      const offPool = pool.subscribe(() => {
        // Membership moved by definition — `pool.subscribe` fires only after
        // `hosts()` reflects it — so the caller is told either way; the fold is
        // for the bookkeeping (a departed host's word is forgotten, an arrived
        // host's is recorded before its snapshot can call it news).
        fold();
        attach();
        cb();
      });

      return () => {
        offPool();
        for (const off of perHost.values()) off();
        perHost.clear();
        lastWord.clear();
      };
    },
  };
}
