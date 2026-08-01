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
 * input re-publishes to whoever is connected now (`republish`). Nothing on either side
 * keeps a second copy of the preference — a stale copy is the exact defect this
 * arrangement exists to kill.
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
import type { NewTerminalPolicy } from "kolu-common/surface";

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
  currentClient(): Promise<NewTerminalPolicyClient> | null;
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

  // Which members were connected as of the last change edge — the transition detector.
  // A push fires only on the false→true crossing, so a member's unrelated state frames
  // (a clock-offset stamp, a log line) don't re-push, while every reconnect does.
  const connected = new Set<string>();

  const pushTo = (host: string): void => {
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
      .then((c) => c.surface.newTerminalPolicy.set(getPolicy()))
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
    },
  });

  // One pass over the family on every change edge (membership OR a member state frame):
  // push whoever just crossed into `connected`. The member set is a handful of hosts, so
  // the walk is cheaper than a per-key subscription bookkeeping scheme.
  const scanForConnects = (): void => {
    for (const host of family.keys()) {
      if (family.get(host)?.phase === "connected") {
        if (!connected.has(host)) {
          connected.add(host);
          pushTo(host);
        }
      } else {
        connected.delete(host);
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
      for (const host of [...connected]) pushTo(host);
    },
  };
}
