/**
 * Push the RESOLVED new-terminal theme policy into every bound padi.
 *
 * padi decides a new terminal's theme (inherit the active one, or shuffle against its
 * own peers) so that EVERY face gets the user's preference — the browser, the CLI, and
 * the MCP agent alike (#2045). But padi knows nothing about preferences: the policy is
 * derived here, from kolu-server's `preferences` + `viewerMode` cells
 * (`currentNewTerminalPolicy` in `../surface.ts`), and pushed into padi's
 * `newTerminalPolicy` cell as a resolved fact.
 *
 * That cell is MEMORY-ONLY in padi by design, so this pusher is what keeps it true:
 * every bind and every RECONNECT is a fresh padi cell holding the baked default, and
 * gets a push the moment its link turns honest-`connected`; every change to either
 * input re-publishes to whoever is connected now (`republish`), skipping the hosts whose
 * derived policy did not actually move. Nothing on either side keeps a second copy of
 * the PREFERENCE — a stale copy is the exact defect this arrangement exists to kill; the
 * per-host `lastPushed` note is a copy of what was SENT, dropped the moment a host
 * leaves `connected`, so it can never let a padi keep an answer it doesn't hold.
 *
 * Membership + per-session state fuse through the reactor's `reactiveFamily`, the same
 * way `serveHostMap` fuses them: the pool's `subscribe` is the membership source, each
 * session's `onState` is the member source, and the family owns the diff, the
 * last-frame hold, and per-member isolation. A push failure is LOGGED at error and
 * never rethrown into the family's listener — the family's `failLoud` rethrows
 * out-of-band and would crash the process, and a padi that refuses the write (an old
 * build surviving a skew fence) must leave the web shell running.
 */

import type { Logger } from "@kolu/log";
import { reactiveFamily, source } from "@kolu/surface/reactor";
import {
  type NewTerminalPolicy,
  newTerminalPolicyEqual,
} from "kolu-common/surface";

/** The client slice a push calls — padi's `newTerminalPolicy` cell `set` verb, and
 *  nothing else. A structural slice (not `PadiSurfaceClient`) so the one call this
 *  module makes is spelled out, and a test can stand in a two-line fake. */
export interface NewTerminalPolicyClient {
  surface: {
    newTerminalPolicy: { set(policy: NewTerminalPolicy): Promise<unknown> };
  };
}

/** The session slice the pusher reads: the state feed it detects the connect edge on,
 *  the HONEST liveness point-read it gates the push on (`currentClient() !== null`
 *  means dialing-OR-connected, never "the far end is live"), and the client the `set`
 *  rides. Narrow like `padiMemoryReadable`'s, so the policy is pinnable without a real
 *  padi session. */
export interface NewTerminalPolicySession {
  onState(cb: (state: { phase: string }) => void): () => void;
  currentState(): { phase: string };
  /** The session's client, UNTYPED here and narrowed by {@link policyWriter} at the
   *  one call site. It is `unknown` because the spec-derived surface face types only
   *  the READ verbs (`SurfaceReadFace` declines every write verb), while the runtime
   *  face `buildSurfaceFace` mints carries `set` — so no declared client type both
   *  matches a real `PadiSession` and names the verb this module calls. The narrow
   *  is CHECKED and fails LOUD rather than silently skipping the push. */
  currentClient(): Promise<unknown> | null;
}

/** Narrow a padi client to the one write verb this module uses.
 *
 *  THROWS on a face that has no `newTerminalPolicy.set` — the wrong-client mistake,
 *  which must read as the programming error it is instead of a push that silently
 *  does nothing (surface-app's `surfaceAppProbe` makes the same call for the same
 *  reason). A padi that genuinely lacks the member is a contract skew the binding's
 *  own version gate refuses long before a push reaches here. */
function policyWriter(client: unknown): NewTerminalPolicyClient {
  const set = (
    client as
      | {
          surface?: { newTerminalPolicy?: { set?: unknown } };
        }
      | undefined
  )?.surface?.newTerminalPolicy?.set;
  if (typeof set !== "function") {
    throw new Error(
      "new-terminal policy push: the bound padi client exposes no `newTerminalPolicy.set` — wrong client, or a padi serving a surface without the member",
    );
  }
  return client as NewTerminalPolicyClient;
}

/** The pool slice the pusher reads — membership plus the session behind a key.
 *  Mirrors `serveHostMap`'s own `MembershipPool` Pick: this never adds or removes. */
export interface NewTerminalPolicyPool<S extends NewTerminalPolicySession> {
  hosts(): string[];
  getSession(host: string): S | undefined;
  subscribe(onChange: () => void): () => void;
}

export interface NewTerminalPolicyPusher {
  /** Re-derive and push to every CURRENTLY-connected member — the seam
   *  `implementKoluSurface`'s `onPolicyInputsChanged` fires when a policy input moves.
   *  Fire-and-forget: each per-host push settles on its own, failures are logged. */
  republish(): void;
}

/** Install the pusher over the warm padi pool. Returns as soon as the listeners are
 *  installed (it awaits nothing — kolu's boot invariant forbids awaiting a `pin()`
 *  here). Process-lifetime, like the pool it rides: there is no `dispose`, because
 *  process death IS the teardown for the web shell's own subscriptions. */
export function installNewTerminalPolicyPusher<
  S extends NewTerminalPolicySession,
>(deps: {
  pool: NewTerminalPolicyPool<S>;
  /** The resolved policy, re-read on EVERY push so a member that connects late gets
   *  today's answer rather than the one that held when this was installed. */
  getPolicy: () => NewTerminalPolicy;
  log: Logger;
}): NewTerminalPolicyPusher {
  const { pool, getPolicy, log } = deps;

  // Which members are connected as of the last change edge, each stamped with the EPOCH
  // of the live link it crossed into — the transition detector. A push fires only on the
  // false→true crossing, so a member's unrelated state frames (a clock-offset stamp, a
  // log line) don't re-push, while every reconnect does (a fresh epoch).
  let nextEpoch = 0;
  const connected = new Map<string, number>();

  // What each member was last SENT, and over WHICH link. `onPolicyInputsChanged` is a
  // bare nudge hung off the whole `preferences` cell, so it fires for every field — a
  // right-panel splitter drag, a seen tip, a scroll-lock flip — while the policy reads
  // only three of them. Without this dedup, each of those writes is an ssh round trip per
  // remote host to rewrite a byte-identical fact. The epoch is what keeps the dedup from
  // ever swallowing a re-prime: padi's cell is memory-only, so a reconnected padi holds
  // the baked default again and its (new) epoch has no entry, whatever the old link was
  // told — including when a push queued against the old link only settles after the drop.
  const lastPushed = new Map<
    string,
    { epoch: number; policy: NewTerminalPolicy }
  >();

  const pushTo = (host: string, epoch: number): void => {
    const session = pool.getSession(host);
    // A member listed with no session yet is the pool's documented reconcile race — the
    // family retries its attach, and the retry's first connected frame pushes. Nothing
    // to degrade to: there is no far end to write to.
    if (session === undefined) return;
    // Honest liveness, exactly like the memory rail's gate: the published phase, never
    // the `currentClient()` pointer (truthy through connecting and whole backoffs).
    if (session.currentState().phase !== "connected") return;
    const client = session.currentClient();
    if (client === null) {
      log.error(
        { host },
        "padi is connected but has no client — new-terminal policy not pushed",
      );
      return;
    }
    void client
      .then(async (raw) => {
        const c = policyWriter(raw);
        // Read the policy HERE, not at the nudge: a cell's `onWrite` fires BEFORE
        // `store.set`, so a synchronous read at the call site would be the OLD value.
        const policy = getPolicy();
        // Skip ONLY what this same link was already told. A push queued against an
        // older link (the client promise settled after a drop) matches no epoch, so it
        // is never mistaken for the current padi's state.
        const previous = lastPushed.get(host);
        if (
          previous?.epoch === epoch &&
          newTerminalPolicyEqual(previous.policy, policy)
        )
          return;
        // …and only record when the link this push rode is still the live one.
        if (connected.get(host) === epoch)
          lastPushed.set(host, { epoch, policy });
        try {
          await c.surface.newTerminalPolicy.set(policy);
        } catch (err) {
          // The far end never took it, so it is not what this host holds — forget it
          // rather than suppressing every later push of the same value.
          lastPushed.delete(host);
          throw err;
        }
      })
      .catch((err: unknown) =>
        log.error({ err, host }, "new-terminal policy push to padi failed"),
      );
  };

  const family = reactiveFamily<string, { phase: string }>({
    members: source(
      (emit) => pool.subscribe(() => emit(pool.hosts())),
      pool.hosts(),
    ),
    attach: (host, set) => pool.getSession(host)?.onState(set),
    onEvict: (host) => {
      connected.delete(host);
      lastPushed.delete(host);
    },
  });

  // One pass over the family on every change edge (membership OR a member state frame):
  // push whoever just crossed into `connected`. The member set is a handful of hosts, so
  // the walk is cheaper than a per-key subscription bookkeeping scheme.
  const scanForConnects = (): void => {
    for (const host of family.keys()) {
      if (family.get(host)?.phase === "connected") {
        if (!connected.has(host)) {
          const epoch = nextEpoch++;
          connected.set(host, epoch);
          pushTo(host, epoch);
        }
      } else {
        connected.delete(host);
        // A padi that dropped out of `connected` comes back with a fresh memory-only
        // cell holding the baked default, so nothing it was sent still holds. The epoch
        // stamp is what actually enforces that; dropping the row just keeps the map from
        // carrying entries for hosts that are gone.
        lastPushed.delete(host);
      }
    }
  };

  family.subscribe(scanForConnects);
  // The family reconciles (and seeds every member synchronously) at construction, BEFORE
  // the subscription above exists — so run the first pass by hand. At boot every padi is
  // still warming and this pushes nothing; it matters for an installer that ever runs
  // against an already-connected pool.
  scanForConnects();

  return {
    republish: () => {
      for (const [host, epoch] of [...connected]) pushTo(host, epoch);
    },
  };
}
