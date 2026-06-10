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
 *   - a **per-URI AbortController** so a single live unsubscribe tears just
 *     that stream while the socket stays open for the others.
 *   - **debounced** `notify(uri)` — deltas can be chatty (a log appending),
 *     so updates coalesce within a window.
 *   - the **generation-token detach-without-abort** teardown: bump a
 *     generation counter *before* disposing the attachment, dispose the
 *     whole client at once (tearing every stream with it), and have each
 *     in-flight stream loop check `gen !== this.generation` so it knows it was
 *     torn down (vs. ended because the source settled) and doesn't reschedule.
 *     Aborting per-stream during a full detach would race the RPC cancel-send
 *     against the transport close (`ERR_STREAM_DESTROYED`); the generation
 *     dance dodges that exact bug. Per-stream abort is reserved for a single
 *     live unsubscribe.
 *   - **bounded retry** while a subscriber waits for a not-yet-live source.
 */

/** Opens the streaming `get` for a subscribable URI on a given client. The
 *  returned async iterable yields once per snapshot/delta — the pusher fires
 *  an `updated` for each. `signal` lets a single-URI unsubscribe tear just
 *  this stream. `undefined` means the URI doesn't resolve to a streamable
 *  source on this client (drop it). */
export type StreamFor<Client> = (
  client: Client,
  uri: string,
  signal: AbortSignal | undefined,
) => Promise<AsyncIterable<unknown>> | AsyncIterable<unknown> | undefined;

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
  /** Retry window while a subscriber waits for a not-yet-live source. */
  retryMs?: number;
  /** Debounce window for `updated` notifications (deltas are chatty). */
  debounceMs?: number;
}

export class ResourcePusher<Client> {
  private readonly subscribed = new Set<string>();
  private client: Client | null = null;
  private readonly aborts = new Map<string, AbortController>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  /** Bumped on every detach; a stream loop that outlives its generation
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
    const client = await this.deps.client();
    if (client === null) {
      this.scheduleRetry();
      return;
    }
    // A concurrent ensureAttached won the race, or we were stopped mid-dial.
    if (this.client !== null || this.stopped) {
      this.deps.dispose?.(client);
      return;
    }
    this.client = client;
    for (const uri of this.subscribed) this.startStream(client, uri);
  }

  private startStream(client: Client, uri: string): void {
    if (this.aborts.has(uri)) return;
    const abort = new AbortController();
    this.aborts.set(uri, abort);
    const gen = this.generation;
    void (async () => {
      let yielded = false;
      try {
        const source = await this.deps.stream(client, uri, abort.signal);
        if (source === undefined) {
          // URI doesn't resolve to a streamable source — drop it quietly.
          this.aborts.delete(uri);
          return;
        }
        for await (const _frame of source) {
          yielded = true;
          if (this.subscribed.has(uri)) this.notify(uri);
        }
      } catch {
        // link torn down (we detached / single-URI abort) or a transport
        // error — the generation check below decides whether to stand ready
        // for the source coming back.
      }
      // A detach bumped the generation and already disposed the client —
      // don't reschedule. Otherwise the stream ended on its own (the source
      // settled / the link dropped while a subscriber still waits): detach
      // and retry so a re-served source re-attaches.
      if (gen !== this.generation) return;
      this.aborts.delete(uri);
      // Only treat a stream that actually produced frames as a "live source
      // that ended" worth re-attaching for; a stream that errored before its
      // first frame (source not live yet) is handled by the retry the failed
      // attach already scheduled, so re-detaching here would thrash.
      if (yielded) {
        this.detach();
        this.scheduleRetry();
      }
    })();
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
    this.aborts.get(uri)?.abort();
    this.aborts.delete(uri);
    const timer = this.timers.get(uri);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(uri);
  }

  private detach(): void {
    // Bump the generation BEFORE disposing so the in-flight stream loops see
    // the change and don't reschedule. Disposing the client tears every
    // stream with it, so we don't abort the controllers here — aborting would
    // race an RPC cancel-send against the transport close
    // (ERR_STREAM_DESTROYED). Per-stream abort is only for a single live
    // unsubscribe (stopStream), where the link stays open for others.
    this.generation += 1;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.aborts.clear();
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
