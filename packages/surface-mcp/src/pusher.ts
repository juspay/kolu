/**
 * The generic `ResourcePusher` — the lifecycle spine.
 *
 * `resources/subscribe` + `notifications/resources/updated` maps a surface
 * primitive's snapshot-then-deltas onto MCP one-to-one: each delta from the
 * primitive's streaming `get` becomes an `updated`, the client re-reads. This
 * class owns the one piece of state that makes that correct under teardown.
 *
 * Ported faithfully from odu's hand-built `src/mcp/resources.ts`, generalized
 * over `(client, uri → streaming get-call)`:
 *
 *   - a **single attachment** (one whole connection — client, disposer, and the
 *     transport's close announcement) held only while something is subscribed;
 *     obtained lazily via the injected client factory, disposed on detach, and
 *     dropped eagerly the moment the transport announces its own close
 *     (juspay/kolu#2082).
 *   - a **per-URI fiber** so a single live unsubscribe tears just that stream
 *     while the socket stays open for the others. Under Effect the subscription's
 *     lifetime IS the fiber's (D10/#18): interrupting it runs the stream's own
 *     scoped finalizers, which is what the old per-URI `AbortController` stood in
 *     for.
 *   - **debounced** `notify(uri)` — deltas can be chatty (a log appending),
 *     so updates coalesce within a window.
 *   - the **generation-token detach** teardown: bump a generation counter
 *     *before* tearing the attachment down, and have each stream fiber's exit
 *     handler check `gen !== this.generation` so it knows it was torn down (vs.
 *     ended because the source settled) and doesn't reschedule.
 *   - **bounded retry** while a subscriber waits for a not-yet-live source.
 *
 * The debounce and retry windows stay on plain `setTimeout`: they are the MCP
 * edge's own timers, not surface work, and keeping them off the Effect clock
 * keeps this class runnable from the SDK's synchronous request handlers.
 */

import type { OwnedSurfaceConnection } from "@kolu/surface/client";
import { Cause, Effect, type Exit, type Fiber, Stream } from "effect";

/** Opens the streaming `get` for a subscribable URI on a given client. The
 *  returned stream emits once per snapshot/delta — the pusher fires an
 *  `updated` for each. `undefined` means the URI doesn't resolve to a
 *  streamable source on this client (drop it).
 *
 *  PURE: it resolves an address into a LAZY stream and must not perform the
 *  subscribe itself. Nothing is dispatched until the pusher runs the stream, and
 *  a throw out of this function is a wiring bug (the resolver was handed a URI
 *  the server never registered), which is left to crash rather than be laundered
 *  into a retry. */
export type StreamFor<Client> = (
  client: Client,
  uri: string,
) => Stream.Stream<unknown, unknown> | undefined;

/** A live connection the pusher OWNS while something is subscribed: the client
 *  it streams over, the disposer that closes whatever the factory opened, and —
 *  where the transport can say so — its close announcement.
 *
 *  It IS the framework's {@link OwnedSurfaceConnection} at this pusher's client
 *  type, not a re-declaration of its three fields. "A client plus the release
 *  the face is responsible for" is one shape and BOTH projecting faces hold it —
 *  the CLI face for the length of one command, this one for a subscription's
 *  lifetime — so a host can write one factory that feeds either. Two structural
 *  spellings had already drifted (one `dispose` returned `void`, the other
 *  `void | Promise<void>`), which is exactly how a value that crosses every
 *  boundary by width-subtyping alone comes apart: juspay/kolu#2082's own failure
 *  mode, one level up.
 *
 *  ONE shape from the dial to the adapter: `@kolu/surface-mcp`'s
 *  `OwnedSurfaceConnection` IS this type at the adapter's client, and kolu-mcp's
 *  `KoluMcpConnection` extends that.
 *
 *  Kept WHOLE: the pusher keys its attachment on this object's identity, which
 *  is what makes the `onClose` guard and the disposer correct together. A bare
 *  client plus a disposer in a side table keyed by the client leaks whenever a
 *  factory returns the same client object twice — two concurrent dials overwrite
 *  each other's entry and the loser's socket is never closed.
 *
 *  ## What an absent `onClose` costs THIS face
 *
 *  The hook is optional on the base because it is a property of the TRANSPORT
 *  (an in-process dispatch has none to drop, and the CLI face never redials).
 *  For this face it is **what keeps a restart from costing a request**
 *  (juspay/kolu#2082). Without it a consumer only learns the transport died by
 *  SPENDING a request on the corpse: the held connection is reset when a call
 *  fails, so the first call after a daemon restart always fails and every later
 *  one succeeds. An MCP host reads that one failure as "the MCP server is dead"
 *  and stops using MCP for the rest of the session — a whole session lost to a
 *  routine upgrade. With the hook, the dead connection is discarded the INSTANT
 *  the socket closes and the next request dials fresh, so nothing is spent.
 *
 *  A dial that HAS the close signal but no field to carry it is a GAP IN THE
 *  DIAL'S FACE, not a mode to live in — the one open case is stated where it
 *  will be closed, at `kolu-cli/src/hostConnect.ts`. An absent hook degrades to
 *  the consumer's lazy reset when a call fails; it is NOT a knob, and a factory
 *  that CAN reach its close must supply it. */
export type PusherConnection<Client> = OwnedSurfaceConnection<Client>;

/** Release a connection and SWALLOW whatever the release does about it — the
 *  one way this face lets go of a socket, at every one of the five sites that
 *  do.
 *
 *  `dispose` may be async (one shape for both faces, and the real one — a unix
 *  socket link — is), so it can REJECT: a finalizer that fails while a daemon
 *  restarts races a socket close every day of the week. A bare `conn.dispose()`
 *  leaves that rejection unhandled, and Node's default for an unhandled
 *  rejection is to TERMINATE the process — killing a long-lived MCP server at
 *  exactly the moment this code is trying to be resilient about a transport
 *  going away. `void conn.dispose()` silences the lint that would have pointed
 *  at it and changes nothing about the rejection.
 *
 *  Ignoring is safe, and it is the only thing that is: every call site has
 *  already stopped pointing at this connection (a lost dial race, a teardown, a
 *  drop, the server closing), so a failed release has nothing left to tell
 *  anyone — while a THROWN one would replace an answer the caller already has.
 *  The socket is going away with the process either way. The CLI face states the
 *  same reason at its own release (`withConnection`, `Effect.ignore`). */
export function disposeQuietly(conn: {
  readonly dispose: () => void | Promise<void>;
}): void {
  try {
    void Promise.resolve(conn.dispose()).catch(() => {});
  } catch {
    // A `dispose` that throws SYNCHRONOUSLY never produces a promise to attach
    // the handler above to, and is the same non-event for the same reason.
  }
}

/** Lazily produce a live connection. Returns `null` when the source isn't live
 *  yet (subscribe-before-serve); the pusher retries. */
export type ClientFactory<Client> = () =>
  | Promise<PusherConnection<Client> | null>
  | PusherConnection<Client>
  | null;

export interface PusherDeps<Client> {
  /** Fire `notifications/resources/updated` for `uri`. */
  notify: (uri: string) => void;
  /** Obtain a live connection. Held while subscribers exist; re-obtained on
   *  retry after a drop. */
  client: ClientFactory<Client>;
  /** Open the streaming source for a subscribed URI. */
  stream: StreamFor<Client>;
  /** Optional sink for unexpected errors the pusher would otherwise swallow —
   *  a rejecting client factory, or a stream that fails before its first
   *  frame. The retry is still scheduled; this is for observability. Omit to
   *  drop them silently. */
  onError?: (err: unknown) => void;
  /** Retry window while a subscriber waits for a not-yet-live source. */
  retryMs?: number;
  /** Debounce window for `updated` notifications (deltas are chatty). */
  debounceMs?: number;
}

export class ResourcePusher<Client> {
  private readonly subscribed = new Set<string>();
  /** The one attachment, whole. `null` = not attached. */
  private conn: PusherConnection<Client> | null = null;
  /** One fiber per live subscription. Interrupting it IS the unsubscribe. */
  private readonly fibers = new Map<string, Fiber.Fiber<void, unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  /** Bumped on every detach; a stream fiber that outlives its generation
   *  knows it was torn down (vs. ended because the source settled) and must
   *  not reschedule. */
  private generation = 0;
  private readonly retryMs: number;
  private readonly debounceMs: number;

  constructor(private readonly deps: PusherDeps<Client>) {
    this.retryMs = deps.retryMs ?? 1000;
    this.debounceMs = deps.debounceMs ?? 200;
  }

  subscribe(uri: string): void {
    if (this.stopped) return;
    this.subscribed.add(uri);
    if (this.conn !== null) {
      this.startStream(this.conn.client, uri);
    } else {
      void this.ensureAttached();
    }
  }

  unsubscribe(uri: string): void {
    this.subscribed.delete(uri);
    this.stopStream(uri);
    if (this.subscribed.size === 0) this.detach();
  }

  stop(): void {
    this.stopped = true;
    this.subscribed.clear();
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.detach();
  }

  /** Visible for tests. */
  get attached(): boolean {
    return this.conn !== null;
  }

  private async ensureAttached(): Promise<void> {
    if (this.conn !== null || this.stopped) return;
    if (this.subscribed.size === 0) return;
    let conn: PusherConnection<Client> | null;
    try {
      conn = await this.deps.client();
    } catch (err) {
      // The client factory rejected (a bridge dial failed). Don't let it
      // become an unhandled rejection — log it and schedule a bounded retry
      // while subscribers still wait, exactly as a `null` (not-live-yet)
      // return does.
      this.deps.onError?.(err);
      this.scheduleRetry();
      return;
    }
    if (conn === null) {
      this.scheduleRetry();
      return;
    }
    // A concurrent ensureAttached won the race, or we were stopped, or the
    // last subscriber left while we were dialing — in every case there's no
    // owner for this freshly-opened connection, so dispose it rather than
    // store an attachment nobody will ever tear down. Disposing the CONNECTION
    // (not a disposer looked up by client identity) is what makes this correct
    // when a factory hands back the same client object on both dials.
    if (this.conn !== null || this.stopped || this.subscribed.size === 0) {
      disposeQuietly(conn);
      return;
    }
    this.conn = conn;
    for (const uri of this.subscribed) this.startStream(conn.client, uri);
    // EAGER INVALIDATION (juspay/kolu#2082), the pusher's half. Registered
    // LAST, after the store and after the streams: the hook may fire
    // synchronously (a transport that already died replays its close at
    // registration), and firing it here means `onAnnouncedClose` tears down a
    // fully-built attachment rather than one half-way up.
    conn.onClose?.(() => this.onAnnouncedClose(conn));
  }

  /** The attached transport ANNOUNCED its close. Drop the attachment and
   *  re-attach on the normal retry, rather than waiting for the stream to fail
   *  and learning it that way.
   *
   *  Identity-guarded, for the same reason the read/tool connection's slot is:
   *  `onClose` fires on the OLD connection's schedule, so a late announcement
   *  from a predecessor must not tear down a successor a retry already
   *  attached. */
  private onAnnouncedClose(conn: PusherConnection<Client>): void {
    if (this.conn !== conn) return;
    this.detach();
    this.scheduleRetry();
  }

  private startStream(client: Client, uri: string): void {
    if (this.fibers.has(uri)) return;
    const source = this.deps.stream(client, uri);
    // URI doesn't resolve to a streamable source — drop it quietly.
    if (source === undefined) return;
    const gen = this.generation;
    // `yielded` distinguishes "the stream produced frames and then ended/dropped"
    // from "it failed before its first frame" — only the latter is reported, since
    // the former is an ordinary end the retry already covers.
    let yielded = false;
    const pump = Stream.runForEach(source, () =>
      Effect.sync(() => {
        yielded = true;
        if (this.subscribed.has(uri)) this.notify(uri);
      }),
    );
    this.fibers.set(
      uri,
      Effect.runFork(
        Effect.onExit(pump, (exit) =>
          Effect.sync(() => {
            this.onStreamExit(uri, gen, yielded, exit);
          }),
        ),
      ),
    );
  }

  /** What a stream fiber's exit means, and what (if anything) to do about it. */
  private onStreamExit(
    uri: string,
    gen: number,
    yielded: boolean,
    exit: Exit.Exit<void, unknown>,
  ): void {
    // A detach bumped the generation and already tore the attachment down —
    // don't reschedule.
    if (gen !== this.generation) return;
    this.fibers.delete(uri);
    // An INTERRUPTION is a teardown we asked for (a single-URI unsubscribe),
    // never a failure — `stopStream` already removed the URI from `subscribed`,
    // so there is nothing to re-attach and nothing to report.
    if (exit._tag === "Failure" && Cause.hasInterrupts(exit.cause)) return;
    if (!this.subscribed.has(uri)) return;
    // Otherwise the stream ended while a subscriber still waits: either it
    // produced frames and then settled / dropped, or it FAILED before its
    // first frame (e.g. the source wasn't live yet, or a transport error on
    // open). Both warrant a detach + bounded retry so a re-served source
    // re-attaches — a pre-first-frame failure here is NOT covered by the
    // attach retry (the attach succeeded; only the stream open failed).
    if (exit._tag === "Failure" && !yielded) {
      this.deps.onError?.(Cause.squash(exit.cause));
    }
    this.detach();
    this.scheduleRetry();
  }

  private notify(uri: string): void {
    if (this.timers.has(uri)) return;
    const timer = setTimeout(() => {
      this.timers.delete(uri);
      if (this.subscribed.has(uri)) this.deps.notify(uri);
    }, this.debounceMs);
    this.timers.set(uri, timer);
  }

  private stopStream(uri: string): void {
    const fiber = this.fibers.get(uri);
    this.fibers.delete(uri);
    if (fiber !== undefined) fiber.interruptUnsafe();
    const timer = this.timers.get(uri);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(uri);
  }

  private detach(): void {
    // Bump the generation BEFORE tearing down so the in-flight exit handlers see
    // the change and don't reschedule. Then interrupt every stream fiber and
    // dispose the client.
    //
    // The oRPC-era version deliberately did NOT abort per-stream here: aborting
    // raced an RPC cancel-send against the transport close (ERR_STREAM_DESTROYED),
    // and disposing the client tore every stream with it anyway. Neither half of
    // that holds now. Interruption is not a message sent over the wire — it
    // releases the stream's own scoped finalizers in-process — and the in-process
    // `directDispatch` has no client to dispose at all, so leaving the fibers
    // running would leak a live handler subscription per URI for the life of the
    // process. The generation token stays because its OTHER job is untouched:
    // telling a fiber's exit handler "you were torn down" from "your source
    // settled".
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const fibers = [...this.fibers.values()];
    this.fibers.clear();
    for (const fiber of fibers) fiber.interruptUnsafe();
    const conn = this.conn;
    this.conn = null;
    if (conn !== null) disposeQuietly(conn);
  }

  private scheduleRetry(): void {
    if (this.stopped || this.subscribed.size === 0) return;
    if (this.retryTimer !== undefined) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.ensureAttached();
    }, this.retryMs);
  }
}
