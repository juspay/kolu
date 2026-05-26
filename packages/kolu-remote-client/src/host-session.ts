/** Narrow consumer interface for a per-host RPC channel.
 *
 *  Lives in `kolu-remote-client` because that's the package whose
 *  whole reason for being is "talk to a remote agent over a typed
 *  session". `kolu-pty`'s `agentPtyProvider` and `kolu-server`'s
 *  host-registry both import from here; no dependency cycle.
 *
 *  Earlier draft placed this in `kolu-shared` for deduplication, but
 *  that maximised blast radius: any change to this high-volatility
 *  transport interface would ripple type-check across every package
 *  in the monorepo, when only ~3 actually consume it.
 *
 *  The narrowing is deliberate: callers see `call` + `subscribe` and
 *  nothing else. The state machine, heartbeat, reconnect, and
 *  subscription re-issue all live behind the interface in
 *  `kolu-server/src/agent/host-session.ts`. */
export interface HostSessionLike {
  /** Request/response RPC. Awaits the remote agent's reply. */
  call(method: string, args: unknown): Promise<unknown>;
  /** Streaming subscription. The returned token's `update` is
   *  fire-and-forget on the wire (mutate the subscription's args);
   *  `close` tears it down. The session re-issues the underlying
   *  subscription transparently across reconnects — the callback
   *  keeps firing without callers seeing the churn. */
  subscribe<UpdateParams = unknown>(
    method: string,
    args: unknown,
    onEvent: (payload: unknown) => void,
  ): {
    update(params: UpdateParams): Promise<void>;
    close(): Promise<void>;
  };
}
