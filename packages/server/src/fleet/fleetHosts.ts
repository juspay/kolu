/**
 * kolu-server's implementation of the fleet face's `FleetHosts` port — the
 * host map as the MCP face sees it: which hosts exist, what they are called,
 * whether each is reachable, and one padi client per host.
 *
 * THE CLIENT DIALS THE SERVED HOST MAP — the same door the browser's socket
 * reaches, not a second surface built beside it.
 *
 * Three in-process addresses for "this host's padi" exist in this process and
 * only ONE of them is the one the product serves:
 *
 *   1. the session's own dispatch (`session.currentDispatch()`) — the WIRE.
 *      Every stream the fleet face opened would be a second upstream
 *      subscription travelling the ssh link beside the browser's, doubling a
 *      remote host's traffic and giving the agent and the operator two
 *      separately folded views of one truth.
 *   2. the per-host re-serve's handlers (`reServeFor(h, s).handlers`) — the
 *      ENTRY surface, `padiSurface` served verbatim, so its handlers are bound
 *      at the STANDALONE tags `surface/<member>/<verb>`. This is what the host
 *      map forwards to; it is not what anything dials.
 *   3. the SERVED HOST MAP (`serveHostMap(padiHostMap, pool, …)` in
 *      `index.ts`) — handlers bound at `surface/padi/<member>/<verb>` behind
 *      the uniform `{ mapKey, input }` envelope, which resolve the host, refuse
 *      a key that is not a member or whose entry has failed, and THEN forward
 *      to (2) through the map's own per-entry dispatch (sibling forwarding,
 *      attach telemetry, per-call link reads and all).
 *
 * This port takes (3). It used to take (2) — `padiClientOver(directDispatch(
 * mirror))` — and that is a face and a runtime built from two different
 * surfaces: `padiClientOver` builds padi's face from `padiSurfaceSibling`
 * (`surface/padi/*`, the tags the MAP serves), while the mirror binds the entry
 * surface's standalone `surface/*` tags. Every terminal-level fleet call
 * therefore died in `directDispatch`'s own fail-loud resolver with `no handler
 * bound at "surface/padi/terminals/keys"`, while the browser — which goes
 * through the map — read the same host fine. Dialling the map is what makes
 * that class unrepresentable: there is one served surface, and the agent and
 * the operator reach it at the same tags.
 *
 * It keeps everything (2) was chosen for: the map forwards to the mirror, so
 * the fleet face still rides the subscriptions kolu-server has already paid
 * for (no socket, no ssh hop, no second fold), and still inherits the mirror's
 * reconnect discipline — a padi that restarts is re-dialled by the session and
 * re-folded by the mirror, and the face on top never knew.
 *
 * REFUSAL IS THE CALLER'S. This port answers `null` for a host that is not
 * connected and reports its `state`; the fleet face is what turns that into a
 * named refusal. A port that invented an empty answer here would be the
 * fallback the repo's rules forbid.
 */

import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import { padiSurfaceSibling } from "@kolu/padi-client/surface";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  type DirectlyDispatchable,
  directDispatch,
} from "@kolu/surface/links/direct";
import { fold } from "@kolu/surface-map";
import type { RemotePool } from "@kolu/surface-remote";
import { decodeHostKey } from "kolu-common/hostKey";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import type { FleetHostState, FleetHosts } from "kolu-mcp";
import type { PadiSession } from "../padi/padiSession.ts";

/** The ONE tag space this port stands on, asserted at import.
 *
 *  `padiClientOver` builds padi's face from `padiSurfaceSibling`, whose members
 *  live at `surface/padi/*`; `padiHostMap` is mounted under the same name and
 *  serves its folded members at `surface/padi/*` too. The two prefixes are
 *  minted by different packages from different constants, so their agreement is
 *  a FACT to check rather than a convention to trust — and the failure it
 *  prevents is the one this module was rewritten for: a face dialling tags
 *  nothing is bound at, which surfaces as `no handler bound at "surface/padi/
 *  terminals/keys"` at the first terminal-level call of a conversation, long
 *  after boot and only on the agent's side. A boot crash says it here instead. */
if (padiSurfaceSibling.tagPrefix !== padiHostMap.tagPrefix) {
  throw new Error(
    `fleet: padi's client face dials "${padiSurfaceSibling.tagPrefix}" while the served host map binds "${padiHostMap.tagPrefix}" — ` +
      "the fleet face would reach no handler at all. The map's mount name (`PADI_SURFACE_NAME`) and padi's own sibling key must be the same word.",
  );
}

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
  /** THE SERVED HOST MAP — `serveHostMap(padiHostMap, pool, …)`'s own
   *  `{ group, handlers }` pair, passed in from the composition root that
   *  built it.
   *
   *  The served value, not the ingredients: handing this port the pool and the
   *  re-serve cache and letting it assemble its own view is exactly how the
   *  face and the runtime came to be two different surfaces. There is one
   *  served map in this process, the browser's socket answers out of it, and
   *  this is it. */
  padiMap: DirectlyDispatchable;
  /** What this machine is called, for the local host's display name — the same
   *  reading the host tab shows (`hostDisplayName`: the local machine by its
   *  hostname, a remote by its ssh target), so a fleet line never says "local"
   *  at an agent that is holding three hosts at once. */
  localName: string;
}

/** One host's calls into the served map: the map's own tags, carrying the map's
 *  own `{ mapKey, input }` envelope.
 *
 *  The twin of `@kolu/surface-map`'s internal `keyInjectingDispatch` (what
 *  `connectSurfaceMap` wraps the BROWSER's transport in), minus the retag —
 *  padi's face already dials the sibling tags the map is mounted at, which is
 *  the equality asserted at the top of this file. The envelope itself is
 *  `fold`, the map's own encoder, never a `{ mapKey, input }` object literal
 *  spelled a second time here: a hand-rolled envelope is a second contract,
 *  and the whole subject of this module is what happens when two of those
 *  disagree.
 *
 *  No `brandDirectDispatch`: the brand records that a dispatch's liveness leg
 *  is constant-true by construction, and the framework's own wrappers
 *  (`keyInjectingDispatch`) do not re-brand either — the face builds the same
 *  way over a wrapped dispatch, and nothing downstream of here reads the
 *  brand. */
function hostCalls(
  map: DirectlyDispatchable,
  hostKey: string,
): SurfaceDispatch {
  const served = directDispatch(map);
  return {
    unary: (tag, input) => served.unary(tag, fold(hostKey, input)),
    stream: (tag, input) => served.stream(tag, fold(hostKey, input)),
  };
}

/** Build the port. Holds no state of its own beyond the per-session client
 *  cache — every question is answered off the live pool at the instant it is
 *  asked, because the roster CHANGES under the conversation. */
export function fleetHostsOver(opts: FleetHostsOptions): FleetHosts {
  const { pool, padiMap, localName } = opts;

  /** One `PadiSurfaceClient` per SESSION. The client itself holds nothing but
   *  the served map and an encoded key — the host is re-resolved by the map on
   *  every call, so a stale one could not answer for a dead link even if it
   *  were handed out. Keying by the session rather than by the key string is
   *  what keeps the table from growing: a host that leaves and returns gets a
   *  new session, and the departed one's client is collectable with it. */
  const clients = new WeakMap<PadiSession, PadiSurfaceClient>();

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
      const cached = clients.get(session);
      if (cached !== undefined) return cached;
      // The SAME face a dialed padi gives, built by the same walk over the
      // same wire tags — and now pointed at the handlers those tags are
      // actually bound to. `key` is the pool's own encoded host string, which
      // is the canonical `mapKey` the map decodes (a non-canonical one is
      // refused by name rather than guessed at). `.padi` is the surface face;
      // the control core on that value is not served by the map and nothing in
      // the fleet face reaches for it.
      const client = padiClientOver(hostCalls(padiMap, key)).padi;
      clients.set(session, client);
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
