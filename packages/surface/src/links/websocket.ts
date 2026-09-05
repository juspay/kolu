/**
 * WebSocket link — the BROWSER leg of the link family (`stdioLink` for
 * subprocess/ssh, `unixSocketLink` for a local daemon, `directLink` in-process).
 *
 * It owns the dial, not just the socket: PLAN D5 makes the surface responsible
 * for the three affordances Effect's own socket layer does not expose to a
 * caller, each of which is a recorded incident rather than a nicety:
 *
 *  1. **A URL thunk re-evaluated on EVERY (re)dial** (review #6c). The connect
 *     URL carries the server's process id, and a reconnect that re-presents a
 *     stale pid is closed again immediately. `Socket.fromWebSocket` acquires
 *     its socket per run and the run is retried, so calling `opts.url()` inside
 *     the acquire is precisely "re-evaluated on every dial".
 *  2. **A terminal-close classifier** (review #5). A close code the app calls
 *     terminal (kolu: surface-app's `STALE_PROCESS_CLOSE_CODE`, 4001) RETIRES
 *     the wire: the retry schedule stops, and every in-flight and future call
 *     fails with `SurfaceTransportRetired`. Without it, connection-level
 *     infinite retry turns the stale-tab retirement into a reconnect storm that
 *     re-presents the same stale pid forever. The classifier is a REQUIRED
 *     option, not a default: the close-code vocabulary belongs to the app that
 *     serves the socket (`@kolu/surface-app` — a package this one may not
 *     depend on, the dependency arrow points the other way), and a link that
 *     guessed it would be guessing about when to stop retrying.
 *  3. **A {@link WatchableWire}** (review #4). `createLiveSignal`'s half-open
 *     watchdog needs open/close observability plus an imperative recovery
 *     action; a websocket can sit `open` at the OS level with no bytes flowing,
 *     which is why the dispatch is branded half-open at the seam and why the
 *     watchdog — not the socket — is the source of truth for liveness.
 *  4. **The re-dial EPOCH, and the calls a re-dial orphaned** (kolu#2101 J1).
 *     Effect RPC registers a call's entry exactly ONCE and never re-sends it
 *     across a re-dial, and an answer can only travel the socket its request
 *     went out on. So every in-flight call belongs to ONE socket — and when the
 *     protocol ends that socket's run WITHOUT broadcasting (the swallowed
 *     `SocketOpenError` arm of `retryTransientErrors`, law 2 of
 *     `socketRedialLaws.test.ts`), those calls are orphaned with no failure to
 *     retry on: they park forever over a wire that reports `open`. The dispatch
 *     returned below therefore FAILS them itself on the next open edge — see
 *     {@link WebsocketLink.diagnostics} and the epoch wrap.
 *
 * There is NO partysocket: reconnect is Effect's socket retry, driven by the
 * schedule below.
 */

import { Cause, Duration, Effect, Layer, Schedule } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { SurfaceTransportRetired } from "../errors";
import { rpcSerializationLayer } from "../frameLimit";
import type { WireStatus, WireTransport } from "../link";
import { supersession } from "./supersession";
import { openWireLink, type WireLink } from "./wire";

/** Close code the link itself uses when {@link WatchableWire.forceReconnect}
 *  severs a wedged-but-open socket. A NORMAL closure (1000) on purpose: the
 *  watchdog is recovering the link, so the classifier must see an ordinary
 *  close and the schedule must re-dial. */
const FORCE_RECONNECT_CLOSE_CODE = 1000;

/** Reconnect backoff, reproducing Effect's own socket default (exponential
 *  from 500ms, factor 1.5, capped at 5s) with ONE addition: the schedule HALTS
 *  the moment the wire is retired, which is what makes "a terminal close ⇒
 *  exactly one close, zero re-dials" a property of the mechanism rather than of
 *  a caller remembering to tear the link down. */
function reconnectSchedule(
  isRetired: () => boolean,
): Schedule.Schedule<number, Socket.SocketError> {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<Socket.SocketError>) =>
      isRetired()
        ? Cause.done(meta.attempt)
        : Effect.succeed([
            meta.attempt,
            Duration.millis(Math.min(500 * 1.5 ** (meta.attempt - 1), 5000)),
          ] as [number, Duration.Duration]),
    ),
  );
}

export interface WebsocketLinkOptions {
  /** The served surface's flat `RpcGroup` (`surface.group`). */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** The connect URL, re-evaluated on EVERY (re)dial — see (1) above. */
  readonly url: () => string;
  /** Does this close code RETIRE the wire? See (2) above. */
  readonly isTerminalClose: (code: number) => boolean;
  /** The platform's WebSocket constructor — the same seam Effect models as
   *  `Socket.WebSocketConstructor`, in the plain-function shape this
   *  Promise-facing API can accept. Omitted in a browser; supplied by a test
   *  (or a Node host) that has no `globalThis.WebSocket`. */
  readonly connect?: (url: string) => WebSocket;
}

/** How many dial attempts the link remembers (kolu#2101 J1). Twenty covers a
 *  whole wake-window flap — a handful of failed dials and the one that stuck —
 *  and is small enough that a tab left open for a week cannot grow it. */
const DIAL_HISTORY_LIMIT = 20;

/** How one dial attempt ended, as the link itself observed it.
 *
 *  `"ended-without-open"` is the one the field was blind to: a dial that failed
 *  BEFORE its socket opened is swallowed by `retryTransientErrors` (law 2 of
 *  `socketRedialLaws.test.ts`) — no broadcast, no status value of its own, no
 *  console line, nothing in the server's log either, because the server never
 *  saw a connection. It is recorded here so a client-side diagnostic can say it
 *  happened.
 *
 *  `"in-flight"` is the attempt currently dialing or connected; it has no
 *  verdict yet, and saying so is more honest than leaving the field absent. */
export type DialClassification =
  | "in-flight"
  | "opened-then-closed"
  | "ended-without-open"
  | "terminal";

/** One dial attempt, timestamped with `Date.now()` (wall clock: these values
 *  are read beside a SERVER log, so they must be comparable to one). */
export interface DialAttempt {
  /** When the acquire ran — before the URL thunk was even evaluated, so a
   *  throwing thunk still leaves a record. */
  readonly startedAt: number;
  /** When the PROTOCOL reported the connection usable (`onConnect`), not when
   *  the raw socket fired `open` — the difference is the poisoned-send window
   *  documented below. Absent ⇒ this dial never opened. */
  readonly openedAt?: number;
  /** When the attempt's run ended (`onDisconnect`, which fires on EVERY attempt
   *  end — including the swallowed ones). Absent ⇒ still in flight. */
  readonly endedAt?: number;
  /** The close code, when a `close` event carried one. Absent for a dial that
   *  failed before any socket existed (a throwing URL thunk) and for one whose
   *  run ended without a close (a ping timeout). */
  readonly closeCode?: number;
  readonly classification: DialClassification;
}

/** What the link knows about its own dialing, for a client-side diagnostic
 *  snapshot (kolu#2101 J1/J2).
 *
 *  Deliberately NOT part of {@link WatchableWire}: that interface is implemented
 *  by hand in tests and by consumers (`fakeWire`), and widening it would break
 *  every such implementation for a fact only a real link can produce. This rides
 *  on the FACTORY-BUILT link object instead, where it is additive. */
export interface WireDiagnostics {
  /** The last {@link DIAL_HISTORY_LIMIT} dial attempts, oldest first. The final
   *  entry is the current one while a dial is in flight or connected. */
  readonly dialHistory: () => readonly DialAttempt[];
  /** How many times this wire has reached `open` — the epoch a call binds to.
   *  A call bound to an epoch the wire has passed was orphaned by a re-dial. */
  readonly epoch: () => number;
}

/** A {@link WireTransport} (the `{ dispatch, wire }` pair `createLiveSignal`
 *  takes as ONE value, so the watchdog cannot probe a different socket than it
 *  reconnects) plus the link's own `dispose` and its dial {@link WireDiagnostics}. */
export interface WebsocketLink extends WireLink, WireTransport {
  readonly diagnostics: WireDiagnostics;
}

/** Open a websocket link to `url()`, returning the branded dispatch, the
 *  watchable wire, and the `dispose` that closes the socket for good. */
export async function websocketLink(
  opts: WebsocketLinkOptions,
): Promise<WebsocketLink> {
  const connect =
    opts.connect ??
    ((url: string) => {
      const ctor = globalThis.WebSocket;
      if (ctor === undefined) {
        throw new Error(
          "websocketLink: no globalThis.WebSocket in this runtime — pass `connect` (the platform's WebSocket constructor).",
        );
      }
      return new ctor(url);
    });

  let status: WireStatus = "connecting";
  const watchers = new Set<(s: WireStatus) => void>();

  // The re-dial EPOCH: how many times this wire has reached `open`. It counts
  // OPEN EDGES off the same funnel every consumer reads, so "the wire completed
  // a re-dial cycle" and "the status said so" can never disagree. It is the
  // shared supersession fence's MARK (`./supersession`, which `followingWire`
  // stands on too); the words below are this leg's own.
  const fence = supersession({
    message: (bound, now) =>
      `the wire re-dialled beneath this call: it was bound to socket epoch ${bound}, the wire is now at epoch ${now}. ` +
      "Effect RPC registers an entry exactly once and never re-sends it across a re-dial, and an answer can only " +
      "travel the socket its request went out on — so this call could only park forever. Failing it is the honest " +
      "signal: the per-subscription retry fence re-subscribes on the new socket.",
    cause: (bound, now) =>
      `websocketLink: re-dial cycle superseded epoch ${bound} (wire now at ${now})`,
  });

  const setStatus = (next: WireStatus): void => {
    if (next === status) return;
    status = next;
    const notify = (): void => {
      for (const watcher of watchers) watcher(next);
    };
    // An OPEN edge ADVANCES the mark, and `advance` owns the order: the mark
    // moves first (so a consumer issuing a call from its own `open` handler has
    // already bound to the NEW epoch and cannot fail its own fresh call), then
    // the consumer notify, then the supersession sweep.
    if (next === "open") fence.advance(notify);
    else notify();
  };

  // ── The dial history (kolu#2101 J1) ─────────────────────────────────────
  // A ring buffer of the last DIAL_HISTORY_LIMIT attempts. Built mutably and
  // handed out as `readonly DialAttempt[]`, because an attempt is written in
  // three places at three moments: the acquire (started), `onConnect` (opened),
  // the socket's own `close` listener (the code) and `onDisconnect` (ended).
  type OpenDialAttempt = {
    -readonly [K in keyof DialAttempt]: DialAttempt[K];
  };
  const dialHistory: OpenDialAttempt[] = [];
  let dial: OpenDialAttempt | undefined;
  const beginDial = (): void => {
    dial = { startedAt: Date.now(), classification: "in-flight" };
    dialHistory.push(dial);
    if (dialHistory.length > DIAL_HISTORY_LIMIT) dialHistory.shift();
  };
  /** Called from `onDisconnect`, which Effect RPC runs with `Effect.ensuring`
   *  on EVERY attempt end — including the ones whose failure it then swallows,
   *  which is precisely what makes `"ended-without-open"` recordable at all. */
  const endDial = (retiredNow: boolean): void => {
    if (dial === undefined) return;
    dial.endedAt = Date.now();
    dial.classification = retiredNow
      ? "terminal"
      : dial.openedAt === undefined
        ? "ended-without-open"
        : "opened-then-closed";
    dial = undefined;
  };

  // Set by the close classifier, read by the retry schedule AND by the error
  // vocabulary — ONE flag, so "stopped retrying" and "fails with
  // SurfaceTransportRetired" can never disagree about whether the wire is
  // retired. It is set from the socket's own 'close' listener, registered when
  // the socket is CONSTRUCTED (before Effect adds its own), so it is already
  // true by the time the run's failure reaches an in-flight call.
  let retired = false;
  let retiredCode: number | undefined;
  let currentSocket: WebSocket | undefined;

  const socket = await Effect.runPromise(
    Socket.fromWebSocket(
      Effect.acquireRelease(
        // `Effect.try`, not `Effect.sync` (kolu#2101 G8c). Both callbacks in here
        // are the CALLER's: `opts.url()` is a thunk an app re-evaluates per dial
        // (kolu's carries the server's pid, read out of live state), and
        // `connect` is a platform constructor that throws on a malformed URL.
        // Run bare, either throw is a DEFECT — and a defect is not what the
        // reconnect schedule retries, so the re-dial promised at the top of this
        // file ("the run is retried, so calling `opts.url()` inside the acquire
        // is precisely re-evaluated on every dial") would stop dead at the first
        // one, leaving a link that reports `connecting` forever and never dials
        // again. As a FAILURE it is an ordinary dial failure: the schedule backs
        // off and re-evaluates the thunk, and a retired wire still halts.
        //
        // `SocketOpenError` is the framework's OWN word for "the dial did not
        // happen", and `fromWebSocket` already types its acquire on
        // `SocketError` — so this classifies into the existing vocabulary rather
        // than minting a surface error nobody downstream would match on.
        Effect.try({
          try: () => {
            // BEFORE the thunk: a thunk that throws is still a dial that
            // happened, and `"ended-without-open"` is exactly the class the
            // field could not see.
            beginDial();
            setStatus("connecting");
            const ws = connect(opts.url());
            currentSocket = ws;
            // The socket's own `close` is where the terminal-close CLASSIFIER runs —
            // the close CODE is only on this event, and this listener is registered
            // before Effect's, so `retired` is already decided by the time the
            // protocol reports the disconnect. It does NOT publish the status: that
            // is the protocol's job (see `connectionHooks` below). It is also the
            // only place the dial history can learn a close code, for the same
            // reason: nothing downstream carries it.
            ws.addEventListener(
              "close",
              (event: Event) => {
                const code = (event as CloseEvent).code;
                if (typeof code !== "number") return;
                if (dial !== undefined) dial.closeCode = code;
                if (opts.isTerminalClose(code)) {
                  retired = true;
                  retiredCode = code;
                }
              },
              { once: true },
            );
            return ws;
          },
          catch: (cause) =>
            new Socket.SocketError({
              reason: new Socket.SocketOpenError({ kind: "Unknown", cause }),
            }),
        }),
        (ws) =>
          Effect.sync(() => {
            if (currentSocket === ws) currentSocket = undefined;
            // 0 CONNECTING / 1 OPEN — anything else is already closing.
            if (ws.readyState <= 1) ws.close(FORCE_RECONNECT_CLOSE_CODE);
          }),
      ),
    ),
  );

  // `WireStatus` is published from the PROTOCOL's connect/disconnect hooks, not
  // from the raw socket's `open`/`close` events — and the difference is a real
  // reconnect bug, not a nicety.
  //
  // Effect's socket protocol latches a `currentError` when a run ends and clears it
  // in its own connect hook; until that clear, every `send` fails IMMEDIATELY with
  // the previous close. The raw `open` listener fires BEFORE that clear (this
  // module registers it inside `acquire`, ahead of the protocol's), so a consumer
  // that acts on the `open` EDGE — surface-app's `createServerLifecycle`, which
  // probes the server's identity there — issued its probe into a protocol that was
  // still poisoned, got the stale `SocketCloseError`, and (correctly) declined to
  // transition. Nothing else ever fires `open` again, so the app sat "disconnected"
  // after every successful reconnect.
  //
  // Publishing from `onConnect` makes `open` MEAN "the protocol can send", which is
  // what every edge consumer already assumed. `onDisconnect` runs on every run end
  // (including a CLEAN 1000 close, which the protocol turns into a failure), so the
  // closed/retired edge stays exactly as observable as before — and it reads the
  // `retired` flag the socket's own `close` listener has already set.
  //
  // BETA-ASSUMPTION(rc.112): `onDisconnect` runs on EVERY attempt end, including
  // the ones whose failure `retryTransientErrors` then swallows — Effect RPC applies
  // `Effect.ensuring(hooks.onDisconnect)` to the whole attempt, OUTSIDE the `tapCause`
  // that returns early for a `SocketOpenError`. Two things below rest on it and on
  // nothing else: the EPOCH (a swallowed attempt must still close its status, or the
  // next open would not read as an edge and an orphaned call would never be failed)
  // and the DIAL HISTORY's `"ended-without-open"` row (a dial nothing else in the
  // system records — not the client, not the server's log). If a bump moved the hook
  // inside the swallow, both would go silent on exactly the shape they exist for.
  // MEASURED by `socketRedialLaws.test.ts` — law 2's status pin and law 3.
  const connectionHooks = Layer.succeed(RpcClient.ConnectionHooks)(
    RpcClient.ConnectionHooks.of({
      onConnect: Effect.sync(() => {
        // Stamped BEFORE the status publish, so an epoch watcher (or a consumer
        // reading `diagnostics` off the `open` edge) never sees an open wire
        // whose current dial claims it never opened.
        if (dial !== undefined) dial.openedAt = Date.now();
        setStatus("open");
      }),
      // `retired` is TERMINAL and is raised INSTEAD of `closed`: the schedule below
      // will not re-dial, so a watchdog that saw `closed` would sit waiting for a
      // reconnect that can never come.
      onDisconnect: Effect.sync(() => {
        endDial(retired);
        setStatus(retired ? "retired" : "closed");
      }),
    }),
  );

  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({
      // Suppresses the failure broadcast while a socket that never OPENED is
      // being re-dialled (`SocketOpenError`); a live socket CLOSING still
      // broadcasts, which is what the face's retry fence needs to see.
      retryTransientErrors: true,
      retryPolicy: reconnectSchedule(() => retired),
    }),
  ).pipe(
    Layer.provide([
      Layer.succeed(Socket.Socket)(socket),
      rpcSerializationLayer,
      connectionHooks,
    ]),
  );

  const link = await openWireLink({
    group: opts.group,
    protocol,
    transportError: (error) =>
      retired
        ? new SurfaceTransportRetired({
            death: "retiredByServer",
            // The close CODE is the whole fact, and the failing call's own
            // `RpcClientError` message is not part of it. Interpolating that
            // message rendered `SocketOpenError`'s fixed `timeout waiting for
            // "open"` whenever a ping timeout coincided with retirement — the
            // one sentence `stdioPingStall.test.ts` exists to keep off an
            // operator's screen, pasted under a verdict that had nothing to do
            // with it. `death` carries WHICH terminal fact this was; the code
            // says which retirement.
            reason: `the server closed this socket with code ${retiredCode}`,
          })
        : // NOT retired: hand the transport failure through unchanged. It is
          // the `RpcClientError` the face's per-subscription retry fence
          // (D3/#12) retries on — translating it here would silently make
          // every reconnect permanent. Its ping timeout is a RETRYABLE orphan,
          // not a terminal fact, so it is a different fact from the duplex
          // leg's and correctly wears a different tag.
          error,
    disposedError: () =>
      new SurfaceTransportRetired({
        death: "disposed",
        reason: retired
          ? "the link was disposed after the server retired this socket"
          : "the link was disposed; request not sent",
      }),
  });

  // ── The epoch wrap: a re-dial cycle FAILS what it orphaned (kolu#2101 J1) ──
  //
  // Why this is needed at all, and why it belongs HERE:
  //
  //  - Effect RPC sends a call's entry EXACTLY ONCE (`RpcClient.js`'s
  //    `Effect.forkIn(scope)` write, at registration) and never re-sends it on a
  //    reconnect, and an answer can only arrive on the socket its request went
  //    out on. So a call is bound to ONE socket by construction.
  //  - When that socket's run ends with a `SocketOpenError` — a pre-open dial
  //    failure, or the ping timeout on an ESTABLISHED socket — the
  //    `retryTransientErrors: true` above (set deliberately, so a socket that
  //    never opened does not flap every consumer) makes the protocol return
  //    early from its `tapCause` WITHOUT broadcasting `ClientProtocolError`,
  //    which is the only thing that fails registered entries. Nothing fails. The
  //    protocol re-dials underneath and the orphaned call parks FOREVER over a
  //    wire that reports `open`. That is the production incident this exists to
  //    kill: a woken tab whose subscriptions were all parked while the socket,
  //    the watchdog and the header dot were all healthy.
  //  - The LINK is the altitude: it is the one closure that owns both the status
  //    funnel and the dispatch it hands out, so every consumer — fenced or not,
  //    stream or unary — is covered without threading a wire reference through
  //    the ~15 call sites the fence has.
  //
  // The rule: a call records the epoch it BINDS to at start. `open` ⇒ the
  // current epoch (its request goes out on this socket). Anything else ⇒ the
  // NEXT one: the write parks in `Socket.fromWebSocket`'s latch and flushes on
  // the next open, so the call belongs to that socket and must NOT be failed by
  // its arrival. When the wire reaches an epoch PAST the binding one, the call
  // is orphaned and fails — the honest signal `fenceStream` already retries on,
  // and the honest signal an unfenced caller needs instead of a dead promise.
  //
  // This coalesces with law 1 (a live socket CLOSING, which DOES broadcast)
  // structurally rather than by bookkeeping: such a call has already failed and
  // its watcher is deregistered before the reopen edge, and the fence's
  // re-subscribe binds to the current/next epoch. One re-drive, never two.
  //
  // The GUARD, the error and the dispatch wrap are the shared fence's
  // (`./supersession`); what stays here is the one rule that is genuinely this
  // leg's — WHICH mark a call binds to.
  const bindingEpoch = (): number =>
    status === "open" ? fence.mark() : fence.mark() + 1;

  const dispatch = fence.wrap(() => link.dispatch, bindingEpoch);

  return {
    dispatch,
    dispose: link.dispose,
    diagnostics: {
      dialHistory: () => dialHistory.map((attempt) => ({ ...attempt })),
      epoch: fence.mark,
    },
    wire: {
      status: () => status,
      onStatus: (cb) => {
        watchers.add(cb);
        return () => {
          watchers.delete(cb);
        };
      },
      // Sever the socket the protocol currently holds; its run fails with a
      // close, the schedule re-dials, and the acquire re-evaluates the URL
      // thunk. (Effect's socket layer exposes no re-dial handle, and
      // interrupting the protocol fiber would kill the transport rather than
      // recycle it — closing the socket IS the re-dial, review #4.) A no-op
      // while a re-dial is already in flight: there is no socket to sever.
      forceReconnect: () => {
        const ws = currentSocket;
        if (ws !== undefined && ws.readyState <= 1) {
          ws.close(FORCE_RECONNECT_CLOSE_CODE);
        }
      },
    },
  };
}
