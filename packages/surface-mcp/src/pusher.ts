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
 *   - a **single attachment** (one surface client) held only while something
 *     is subscribed; obtained lazily via the injected client factory.
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

/** Lazily produce a live surface client. Returns `null` when the source
 *  isn't live yet (subscribe-before-serve); the pusher retries. */
export type ClientFactory<Client> = () =>
  | Promise<Client | null>
  | Client
  | null;

export interface PusherDeps<Client> {
  /** Fire `notifications/resources/updated` for `uri`. */
  notify: (uri: string) => void;
  /** Obtain a live client. Held while subscribers exist; re-obtained on
   *  retry after a drop. */
  client: ClientFactory<Client>;
  /** Open the streaming source for a subscribed URI. */
  stream: StreamFor<Client>;
  /** Optional disposer run on detach (close the dialed socket etc.). The
   *  bridge case passes one; the in-process case may not need it. */
  dispose?: (client: Client) => void;
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
  private client: Client | null = null;
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
    if (this.client !== null) {
      this.startStream(this.client, uri);
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
    return this.client !== null;
  }

  private async ensureAttached(): Promise<void> {
    if (this.client !== null || this.stopped) return;
    if (this.subscribed.size === 0) return;
    let client: Client | null;
    try {
      client = await this.deps.client();
    } catch (err) {
      // The client factory rejected (a bridge dial failed). Don't let it
      // become an unhandled rejection — log it and schedule a bounded retry
      // while subscribers still wait, exactly as a `null` (not-live-yet)
      // return does.
      this.deps.onError?.(err);
      this.scheduleRetry();
      return;
    }
    if (client === null) {
      this.scheduleRetry();
      return;
    }
    // A concurrent ensureAttached won the race, or we were stopped, or the
    // last subscriber left while we were dialing — in every case there's no
    // owner for this freshly-opened client, so dispose it rather than store an
    // attachment nobody will ever tear down.
    if (this.client !== null || this.stopped || this.subscribed.size === 0) {
      this.deps.dispose?.(client);
      return;
    }
    this.client = client;
    for (const uri of this.subscribed) this.startStream(client, uri);
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
    const client = this.client;
    this.client = null;
    if (client !== null) this.deps.dispose?.(client);
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
