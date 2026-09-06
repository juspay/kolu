/**
 * THE ONE DIALLED CONNECTION this adapter holds for reads and tool calls — its
 * whole lifetime, as one value.
 *
 * ## Why this is a module and not six closure-held bindings
 *
 * "The lifetime of one dialled connection" is a single axis of change: hold it
 * lazily, coalesce concurrent dials, drop it eagerly when the transport announces
 * its close, guard every drop by identity, discard a dial that a supersession
 * event overtook, and release quietly at every exit. `serveSurfaceAsMcp` used to
 * spell all of that inline, in the middle of the SDK wiring, over six mutable
 * bindings a dozen nested functions read and wrote — and the legality of each
 * combination was held by prose and by statement order. One writer here runs on a
 * clock of its own (the transport's `onClose` fires on no request's schedule), so
 * statement order was never available as a guarantee to begin with.
 *
 * It depends on `dial()` and on nothing else about MCP, which is what makes it
 * unit-testable without a transport, and what makes the pairing rule that stays
 * behind (`withClient`'s generation identity test) legible as the separate thing
 * it is.
 *
 * ## The state, as ONE tagged value
 *
 * Never a connection-or-null beside a `closed` flag beside an in-flight-dial
 * cell. Three independent cells have eight combinations and only four legal ones;
 * split cells also make it easy to gate the MIDDLE of a dial without gating its
 * ENTRY, which lets a request landing after teardown really open a socket and
 * dispose it on the next line. A tag puts the gate at the front for free, and
 * every guard below is one tag test rather than a remembered rule.
 */

import {
  disposeQuietly,
  type OwnedSurfaceConnection,
} from "@kolu/surface/client";
import { match } from "ts-pattern";

/** How many times {@link SharedConnection.get} dials before giving up on a
 *  connection that keeps arriving already dead. Three attempts, not two: the
 *  second covers the ordinary race (a daemon that went down between the dial and
 *  its registration) and the third distinguishes an unlucky moment from a daemon
 *  that cannot hold a connection at all — and saying so beats spinning. */
const BORN_DEAD_DIAL_ATTEMPTS = 3;

/** The wall-clock half of the same bound, armed alongside the count so the
 *  guarantee is TRANSPORT-INDEPENDENT: "a request is never delayed more than this
 *  by born-dead redials", whatever a dial costs.
 *
 *  A count alone is only cheap while a dial is. Over a unix socket it nearly is —
 *  though not the "~1ms" it is tempting to claim: each redial re-runs the factory,
 *  and kolu-cli's local one re-resolves the running padi
 *  (`resolveRunningPadiSocket`: a synchronous `readdirSync` over the runtime-dir
 *  regimes plus a `statSync`/manifest-read/`kill(pid, 0)` per candidate) before the
 *  connect and its `hello` round-trip. Bounded and only on a failure path, but
 *  milliseconds each, not one.
 *
 *  This slot ALREADY holds a link where a count would be the wrong unit:
 *  `kolu mcp --host` feeds an ssh dial that provisions a closure on the far side,
 *  seconds to minutes. It never re-dials today only because that dial supplies no
 *  `onClose` — transport luck, not a guarantee, and it evaporates the day the
 *  remote leg projects its close signal.
 *
 *  Ten seconds, and the deadline is only ever read BETWEEN attempts — it never
 *  cuts a dial short. So it is generous next to a socket dial (all three attempts
 *  finish inside it, and the count is what trips) and tight next to an ssh
 *  provision (the first one runs to completion; a second and third cannot stack
 *  behind one MCP request). Not a knob: a better-chosen invariant. */
const BORN_DEAD_DIAL_BUDGET_MS = 10_000;

/** The one connection the read/tool path shares, and every way it can end. */
export interface SharedConnection<Client> {
  /** Hand out a LIVE connection, dialling if there is none and coalescing with
   *  any dial already in flight. */
  get(): Promise<OwnedSurfaceConnection<Client>>;
  /** This connection died — ANNOUNCED by its transport, or discovered by a call
   *  that failed on it. Inert unless `conn` is still the current one. */
  drop(conn: OwnedSurfaceConnection<Client>): void;
  /** The ROSTER moved: retire the current connection so the next {@link get}
   *  dials a bundle carrying the new siblings' clients. NOT terminal — this
   *  endpoint keeps serving. */
  retire(): void;
  /** Terminal. The server is closing. */
  dispose(): void;
}

/** Build the shared slot over a dial factory.
 *
 *  A dead connection is dropped by TWO paths, and the order matters:
 *
 *    1. EAGERLY, the moment the transport says it closed (`onClose`, wired below).
 *       This is the one that matters in practice — a daemon restart is announced,
 *       so the corpse is discarded while the adapter is idle and the next request
 *       dials fresh. It needs the transport to carry the announcement all the way
 *       to the factory; where a dial does not yet project one (see
 *       `OwnedSurfaceConnection`) only (2) is left.
 *    2. LAZILY, by the caller, when a call fails with a recognized transport death
 *       — {@link SharedConnection.drop}. This remains the backstop for the two
 *       cases (1) cannot cover: a dial that carries no close announcement, and the
 *       genuine race where the socket dies with a request already in flight.
 *
 *  (2) alone was the whole of juspay/kolu#2082: a restart could only be discovered
 *  by spending a request on the dead socket. */
export function makeSharedConnection<Client>(
  dial: () => Promise<OwnedSurfaceConnection<Client>>,
): SharedConnection<Client> {
  type Conn = OwnedSurfaceConnection<Client>;
  type ConnState =
    | { readonly t: "idle" }
    /** A dial is in flight, memoized so two concurrent callers (a long-blocking
     *  wait tool beside a read — the kolu-mcp case) share ONE dial instead of
     *  each racing an emptiness check across the await and opening (then leaking)
     *  a second socket. */
    | { readonly t: "dialing"; readonly dial: Promise<Conn> }
    | { readonly t: "live"; readonly conn: Conn }
    /** Terminal. Reached only by teardown, and never left. */
    | { readonly t: "closed" };

  let state: ConnState = { t: "idle" };
  /** Which ROSTER the current connection was dialled for. Bumped by every
   *  {@link SharedConnection.retire}, and read by a dial that finishes AFTER one:
   *  the bundle it carries describes the old sibling set, so publishing it would
   *  answer the next request's call on a client map that no longer matches the
   *  tables the same request resolved its address against. One counter, checked at
   *  the one place a dial publishes, is the whole of it. */
  let rosterEpoch = 0;
  /** The one sentence a caller gets when the roster moved out from under its
   *  dial. Named because BOTH windows raise it and they must read alike: a
   *  `retire()` landing while the dial was in flight (`dialOnce`), and one
   *  landing between the slot publishing and `get` re-checking it. Neither is a
   *  transport that will not stay up, which is the only other thing that empties
   *  the slot and the thing this used to be mistaken for. */
  const rosterMoved = (): Error =>
    linkFailure(
      "the sibling roster moved while this connection was being dialled, so " +
        "the bundle it carries is a generation behind the tables this request " +
        "resolved against",
      "retry, and the next dial carries the new roster",
    );

  const drop = (conn: Conn): void => {
    // The identity guard is the single invariant: a drop is inert unless `conn`
    // is still the current one, so a late/duplicate announcement from a disposed
    // predecessor can never dispose the fresh successor another call already
    // redialed.
    if (state.t !== "live" || state.conn !== conn) return;
    state = { t: "idle" };
    // Released QUIETLY: the framework's `dispose` may be async and may reject,
    // and this slot has already stopped pointing at the connection.
    void disposeQuietly(conn);
  };

  const dialOnce = async (): Promise<Conn> => {
    const epoch = rosterEpoch;
    let conn: Conn;
    try {
      conn = await dial();
    } catch (err) {
      // Only OUR generation's slot is ours to reset. A retire that landed
      // mid-dial has already put the slot back to `idle` and a fresh dial may
      // hold it; resetting it here would orphan that one's memo and let two
      // callers open two sockets.
      if (state.t === "dialing" && rosterEpoch === epoch) state = { t: "idle" };
      throw err;
    }
    if (rosterEpoch !== epoch) {
      void disposeQuietly(conn);
      throw rosterMoved();
    }
    // Teardown won the race while we dialed: there is no slot to publish into,
    // so dispose the just-opened socket rather than orphan it (the adapter's
    // promise: dispose every connection it opens). Reject so a caller mid-`get`
    // fails loud instead of running against a socket about to close. ONE tag
    // test is the whole gate here: "am I still the dial this slot is waiting on"
    // answers both "was the server closed" and "did another dial take the slot",
    // so neither needs a cell of its own to fall out of sync.
    if (state.t !== "dialing") {
      void disposeQuietly(conn);
      throw new Error(
        "the server closed while this connection was being dialed",
      );
    }
    state = { t: "live", conn };
    // EAGER INVALIDATION (#2082). Registered AFTER the store, so the identity
    // guard in `drop` can see this connection as the current one — and on the
    // SUCCESS path only, because a connection the teardown test above already
    // disposed has no slot to invalidate.
    //
    // This call can invoke its callback BEFORE it returns. A transport that died
    // during the dial replays the close at registration — padi's does it on a
    // microtask, and the contract permits a plain synchronous `cb()` — so by the
    // next line the state may already be back at `idle`. `get` is what handles
    // that; see the born-dead loop.
    conn.onClose?.(() => drop(conn));
    return conn;
  };

  /** The in-flight or memoized dial. Coalescing, the closed-gate, and the
   *  fresh-dial decision are one tag test each. */
  const dialShared = (): Promise<Conn> =>
    match(state)
      // Gated at the ENTRY: a post-teardown request must not open a socket only
      // to dispose it on the next line.
      .with({ t: "closed" }, () =>
        Promise.reject(
          new Error("the server is closed — no connection to dial"),
        ),
      )
      .with({ t: "live" }, ({ conn }) => Promise.resolve(conn))
      .with({ t: "dialing" }, ({ dial: pending }) => pending)
      .with({ t: "idle" }, () => {
        const pending = dialOnce();
        state = { t: "dialing", dial: pending };
        return pending;
      })
      .exhaustive();

  return {
    /** A dial can land already dead: the transport announces its close during
     *  registration, so `drop` disposes the connection before the awaiting caller
     *  ever resumes. Returning it anyway would spend that caller's request on a
     *  corpse — #2082's exact symptom, reintroduced through the door opened to fix
     *  it. So the slot is re-checked by identity after the dial settles, and a
     *  connection that is no longer current is re-dialed rather than handed out.
     *
     *  Re-dialing here is safe in the way re-REQUESTING is not, and the
     *  distinction is the whole reason this loop is allowed to exist: a dial
     *  carries no caller intent, so repeating one replays nothing. Repeating the
     *  REQUEST is what would resend a mutation into a fresh daemon generation, and
     *  that is still never done. */
    get: async (): Promise<Conn> => {
      const started = Date.now();
      const deadline = started + BORN_DEAD_DIAL_BUDGET_MS;
      // WHICH roster this caller is dialling for. The identity check below fails
      // for two unrelated reasons, and only one of them is a born-dead
      // connection: a `retire()` landing after the slot published empties it too,
      // and looping on THAT reports a daemon "not staying up long enough to carry
      // a request" — false of a daemon that is up and whose roster simply moved.
      // `dialOnce` already tells the two apart for a retire that lands mid-dial;
      // this is the same question for one that lands mid-await, which the
      // `{t:"live"}` fast path makes reachable with no I/O in the window at all.
      const epoch = rosterEpoch;
      let attempts = 0;
      while (attempts < BORN_DEAD_DIAL_ATTEMPTS && Date.now() < deadline) {
        attempts += 1;
        const conn = await dialShared();
        // Still the current connection ⇒ it did not announce a close on the way
        // out, so it is live as far as anything here can know.
        if (state.t === "live" && state.conn === conn) return conn;
        if (rosterEpoch !== epoch) throw rosterMoved();
      }
      throw linkFailure(
        `the served surface's transport closed immediately on each of ${attempts} consecutive dials over ${
          Date.now() - started
        }ms — it is not staying up long enough to carry a request`,
        "retry once the served daemon is holding connections",
      );
    },
    drop,
    /** The epoch is bumped FIRST so a dial already in flight finds itself a
     *  generation behind and disposes its own result (see `dialOnce`) rather than
     *  publishing a stale bundle into the slot this line just emptied. */
    retire: (): void => {
      rosterEpoch += 1;
      const prev = state;
      if (prev.t === "closed") return;
      state = { t: "idle" };
      if (prev.t === "live") void disposeQuietly(prev.conn);
    },
    /** Move to the terminal state FIRST (so a still-pending dial finds no slot to
     *  publish into and disposes its own result — see `dialOnce`), then dispose
     *  whatever connection is current (identity-agnostic — the server is closing,
     *  so there is no successor to protect). */
    dispose: (): void => {
      const prev = state;
      state = { t: "closed" };
      if (prev.t === "live") void disposeQuietly(prev.conn);
    },
  };
}

/** EVERY failure this adapter reports for a LINK problem, framed for a host
 *  standing on its own stdio channel. The policy, in one place:
 *
 *    1. name the layer that actually died — the raw error is the LINK's own
 *       vocabulary ("stdio transport closed … the peer process exited"), true of
 *       the link and badly false of everything above it;
 *    2. say THIS MCP SERVER IS STILL RUNNING and has discarded the corpse. An MCP
 *       host reads a link-death message on its own stdio channel and concludes the
 *       MCP server exited, so it stops calling — exactly what happened in
 *       juspay/kolu#2082, where one such message cost the rest of an agent's
 *       session;
 *    3. say what retrying does, since the caller's next move is the whole point.
 *
 *  A `cause` is kept where there is one, so the underlying reason survives the
 *  re-frame (a re-frame must add context, never swallow it).
 *
 *  TEARDOWN is the one link failure this policy does NOT cover, and deliberately:
 *  when the server really is shutting down, "this MCP server is still running"
 *  would be a lie. Those two throws (`dialShared`'s closed gate and `dialOnce`'s
 *  lost race) say plainly that the server closed, and nothing more. */
export function linkFailure(
  what: string,
  retry: string,
  cause?: unknown,
): Error {
  return new Error(
    `${what}. This MCP server is still running and has discarded the dead ` +
      `connection — ${retry}.`,
    cause === undefined ? undefined : { cause },
  );
}
