/**
 * The active-connection manager — the CLIENT-side twin of `@kolu/surface-nix-host`'s
 * `buildHostRegistry`. A keyed cache of live client connections with exactly ONE active;
 * switching the active one RETIRES the outgoing connection (the consumer's `dispose()`
 * closes its socket + stubs `send` to throw, so a late call can't misroute), warms the
 * incoming one with a slow async step where last-intent-wins over overlapping picks, and
 * falls back when a server rejects the active key at the handshake.
 *
 * Domain-agnostic by construction (the electricity boundary): it knows nothing about
 * hosts, padi, ssh, or toasts. The consumer plugs in the volatile parts as POLICY — how
 * to build a connection, which socket carries the rejection, how to warm a key, what the
 * fallback key is, and how to react (toast / message) — and reads back `activeKey`,
 * `activeConnection`, `connectionScoped`, `switchTo`, and `setActive`.
 *
 * kolu is the first consumer: its `binding/` module becomes pure padi policy (which host,
 * the picker, recents) over this receptacle.
 */

import { type Accessor, createSignal } from "solid-js";
import { connectionScoped } from "./keyedRoot";

/** A connection the manager owns — retirable + disposable. Consumers' richer connection
 *  types (kolu's `Binding`, with clients/link/socket/status) extend this. */
export interface ManagedConnection {
  /** True once this connection has been retired (switched away from + torn down). */
  retired: boolean;
  /** Close the transport + tear down the connection (the misroute-guard teardown). */
  dispose(): void;
}

/** The socket shape the manager attaches its server-rejected-close listener to — the
 *  narrowest surface it needs (never the concrete socket type). */
export interface RejectableSocket {
  addEventListener(type: "close", cb: (ev: { code?: number }) => void): void;
}

export interface ActiveConnectionManager<K, C extends ManagedConnection> {
  /** The key of the currently-active connection — reactive; a switch re-derives every
   *  reader (accessors, `connectionScoped` subs). */
  readonly activeKey: Accessor<K>;
  /** The active connection — lazily built + cached, rebuilt if the cached one is retired. */
  activeConnection(): C;
  /** Open a subscription against the ACTIVE connection, re-keyed on every switch (rides
   *  {@link connectionScoped}: prior root disposed first, sync-populated, owner-safe). */
  connectionScoped<T>(factory: (connection: C) => T): Accessor<T>;
  /** Switch the active key, live — warm (if any) with last-intent-wins over overlapping
   *  picks, then swap. */
  switchTo(key: K): Promise<void>;
  /** Swap the active key WITHOUT warming — for the consumer's own policy (seed a default,
   *  forget-and-fall-back, a rejection fallback). Flip-then-retire, same as `switchTo`'s
   *  tail. */
  setActive(key: K): void;
  /** Re-read the persistence source and adopt it if it differs (a boot re-read after the
   *  module already loaded). No-op without `persistence`. */
  restore(): void;
}

export interface ActiveConnectionManagerOptions<
  K,
  C extends ManagedConnection,
> {
  /** The key active before any switch (used unless `persistence.read()` restores one). */
  initialKey: K;
  /** POLICY: build a live connection for a key (kolu: `connectSurfaces` + lifecycle +
   *  retire wiring assembled into a `Binding`). */
  makeConnection: (key: K) => C;
  /** POLICY: which socket of a connection carries the server-rejected close (kolu: `b.ws`). */
  socketOf: (connection: C) => RejectableSocket;
  /** POLICY: whether a key is the fallback (never warmed, never falls back to itself;
   *  kolu: `key === LOCAL_HOST`). */
  isFallbackKey: (key: K) => boolean;
  /** POLICY: the key to fall back to when a server rejects the active key. */
  fallbackKey: K;
  /** The close code a server uses to reject an unknown/stale key at the handshake (kolu:
   *  `1008`). The manager owns the PREDICATE; the reaction is `onServerRejected`. */
  serverRejectedCloseCode: number;
  /** Key equality — default `===` (override for structural keys). */
  keyEquals?: (a: K, b: K) => boolean;
  /** POLICY: warm a key server-side before connecting (kolu: `hosts.add` via the CURRENT
   *  active connection's link — hence it receives it). Skipped for a fallback key. */
  warm?: (key: K, activeConnection: C) => Promise<void>;
  /** POLICY: react to a `warm` failure. `superseded` is true when a newer pick has won —
   *  stay silent then (don't toast over a host the user already moved on from). */
  onWarmError?: (key: K, err: unknown, superseded: boolean) => void;
  /** POLICY CALLBACK: react to a server rejecting `key` at the handshake — the toast +
   *  whether/where to fall back are the consumer's (kolu: toast + `switchTo(fallback)`).
   *  A policy callback, not a config field: a config string can't express "which key to
   *  land on" or gate wording on context. */
  onServerRejected: (key: K) => void;
  /** POLICY: per-tab (or per-scope) persistence of the active key. `store` is called on
   *  every `setActive`; `read` seeds the initial key + backs `restore()`. */
  persistence?: { read(): K | undefined; store(key: K): void };
}

/** Build an active-connection manager. See the module doc. */
export function createActiveConnectionManager<K, C extends ManagedConnection>(
  opts: ActiveConnectionManagerOptions<K, C>,
): ActiveConnectionManager<K, C> {
  const eq = opts.keyEquals ?? ((a, b) => a === b);
  const [activeKey, setActiveKey] = createSignal<K>(
    opts.persistence?.read() ?? opts.initialKey,
  );
  const cache = new Map<K, C>();

  // The switch epoch (last-intent-wins). A warm step (kolu's `hosts.add` over ssh) takes
  // seconds, so picks overlap. Every `switchTo` claims an epoch as its FIRST act — before
  // the same-key early return, so re-picking the CURRENT key still bumps the epoch and
  // thereby CANCELS an in-flight warm for a different key. After the await, a pick that is
  // no longer latest bows out instead of yanking the active key (last-pick-wins, not
  // first-resolve-wins).
  let pickEpoch = 0;

  function activeConnection(): C {
    const k = activeKey();
    let c = cache.get(k);
    if (!c || c.retired) {
      c = opts.makeConnection(k);
      cache.set(k, c);
      // Attach the server-rejected-close fallback at BUILD time (once per connection),
      // for this key only, before it retires.
      opts.socketOf(c).addEventListener("close", (ev) => {
        if (
          ev.code === opts.serverRejectedCloseCode &&
          !c!.retired &&
          !opts.isFallbackKey(k) &&
          eq(activeKey(), k)
        ) {
          opts.onServerRejected(k);
        }
      });
    }
    return c;
  }

  function setActive(key: K): void {
    const prev = activeKey();
    if (eq(key, prev)) return;
    // Flip the active key FIRST: this re-keys every `connectionScoped` sub off the
    // outgoing connection (its per-key root disposed synchronously → its subs aborted)
    // BEFORE we retire the socket below, so a disposed sub can't report the retired
    // socket's error. THEN retire the previous connection (close its socket, tear it
    // down) — the misroute guard: any in-flight call on the old socket now rejects.
    setActiveKey(() => key);
    opts.persistence?.store(key);
    const old = cache.get(prev);
    if (old) {
      cache.delete(prev);
      old.dispose();
    }
  }

  async function switchTo(key: K): Promise<void> {
    const myPick = ++pickEpoch;
    if (eq(key, activeKey())) return;
    if (!opts.isFallbackKey(key) && opts.warm) {
      // Warm via the CURRENT active connection (its link carries the shared pool) — a
      // deliberate "warm from wherever you are", not the target's not-yet-built connection.
      try {
        await opts.warm(key, activeConnection());
      } catch (err) {
        opts.onWarmError?.(key, err, myPick !== pickEpoch);
        return;
      }
    }
    if (myPick !== pickEpoch) return; // a newer pick won — don't yank the active key back
    setActive(key);
  }

  function restore(): void {
    const k = opts.persistence?.read();
    if (k !== undefined && !eq(k, activeKey())) setActiveKey(() => k);
  }

  return {
    activeKey,
    activeConnection,
    connectionScoped: (factory) =>
      connectionScoped(activeKey, activeConnection, factory),
    switchTo,
    setActive,
    restore,
  };
}
