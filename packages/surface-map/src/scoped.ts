/// <reference types="node" />

/**
 * `scopedByEntry` — per-key CLIENT-side state whose lifetime is `entries`
 * MEMBERSHIP, not the wire.
 *
 * The sibling of `useEntry`/`createKeyedRoot` (dispose-on-key-CHANGE, right for
 * cheap-to-reopen wire subscriptions) with the OPPOSITE lifetime: a key's owned
 * world is RETAINED across a switch-away and DISPOSED only when the key leaves
 * the map. That is the "shape B" a multi-host client needs for its OWN state —
 * the focused tile, the camera, per-host view posture — so switching hosts
 * restores the world you left instead of showing the wrong host's leftovers.
 *
 * Built on `@solid-primitives/keyed`'s `keyArray` (the ecosystem's
 * retained-per-key-root primitive — a dependency, not a reimplementation), plus
 * the map-tied glue: the key set is derived from the client's `entries`
 * membership, and "which key is active" stays APP POLICY (a signal the caller
 * owns — kolu's `activeHost`, drishti's `selectedHost`).
 *
 * Two settled lifetime rules make the owners "lazy, retained, membership-tied":
 *   • LAZY — an owner is built on a key's FIRST activation, never for a member
 *     you have not visited (a background host costs nothing: no owner, no
 *     subscriptions; W5 attention reads the wire, not the scope);
 *   • MEMBERSHIP-TIED — an owner is retained across every switch-away and
 *     disposed the instant its key leaves `entries`. Because exit also drops the
 *     key from the activated set, a removed-then-re-added host is a FRESH member:
 *     lazy again, rebuilt on its next activation, never resurrected from a stale
 *     activated entry.
 *
 * `ctx.isActive` is where active-only discipline (WebGL release/re-acquire,
 * center-on-active) lives INSIDE the owner — the camera co-owned/co-mounted with
 * the tiles it centers on, so the mount→measure→center ordering is intrinsic,
 * not a bridge between two independently-timed lifecycles (the race a defer-guard
 * narrows but never closes).
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import type { Subscription } from "@kolu/surface/solid";
import { keyArray } from "@solid-primitives/keyed";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  getOwner,
  onCleanup,
} from "solid-js";
import type { z } from "zod";
import type { Entry, SurfaceMapClient } from "./client";

// ── The shared membership kernel ──────────────────────────────────────────
//
// `scopedByEntry` and `watchByEntry` are ONE kernel, two policies. The kernel —
// codec identity, the `entries` membership view, and retained-per-key roots
// disposed on membership exit — is shared HERE, never re-derived. The only
// difference is the SOURCE key list fed to the roots: `scopedByEntry` feeds the
// LAZY `activated` set (a key's world is built on first activation), while
// `watchByEntry` feeds the EAGER full member set (every host gets a root
// immediately — a background host is precisely the one you need to hear from).

function requireOwner(name: string): void {
  if (!getOwner()) {
    throw new Error(
      `${name} must run under a reactive owner — it owns a keyArray of per-key ` +
        "roots disposed on membership exit, and would leak them otherwise. Call " +
        "it inside a component / createRoot / the app-root owner.",
    );
  }
}

interface MembershipKernel<K> {
  /** The ONE identity authority: a key → its canonical wire string via the map's
   *  codec. Keys cannot be compared by `===` (independent decodes of one logical
   *  key need not be reference-equal); string identity side-steps it. */
  readonly enc: (key: K) => string;
  /** Every current member key, from the `entries` membership view (opened ONCE —
   *  a second `.use()` is a second wire subscription). */
  readonly memberKeys: Accessor<K[]>;
  /** The encoded member set — for membership-exit pruning. */
  readonly memberSet: Accessor<Set<string>>;
}

function membershipKernel<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Cause extends string,
>(client: SurfaceMapClient<KS, ES, Cause>): MembershipKernel<z.infer<KS>> {
  const enc = (key: z.infer<KS>): string => client.codec.encode(key);
  const entriesView = client.entries.use();
  const memberKeys = createMemo(() => entriesView.keys());
  const memberSet = createMemo(() => new Set(memberKeys().map(enc)));
  return { enc, memberKeys, memberSet };
}

/** Retained-per-key roots over a SOURCE key list, eager-pinned. A key's root
 *  (and everything `build` opens inside it) persists while the key stays in
 *  `sourceKeys` and is disposed the moment it leaves — `@solid-primitives/keyed`'s
 *  `keyArray` (the ecosystem's retained-per-key-root primitive), read in a render
 *  effect so build/dispose happen SYNCHRONOUSLY on a membership change, never
 *  lazily on the next read. Returns the enc→world index both accessors read. */
function keyedRoots<K, T>(
  enc: (key: K) => string,
  sourceKeys: Accessor<K[]>,
  build: (key: K) => T,
): Accessor<Map<string, T>> {
  const scopes = keyArray(sourceKeys, enc, (item): T => build(item()));
  createRenderEffect(() => void scopes());
  return createMemo(() => {
    const keys = sourceKeys();
    const built = scopes();
    const m = new Map<string, T>();
    // keyArray returns owners aligned 1:1 with `keys`, so `built[i]` is present.
    keys.forEach((key, i) => {
      m.set(enc(key), built[i] as T);
    });
    return m;
  });
}

export interface ScopedByEntry<K, T> {
  /** The active key's owned world — re-keys on a switch. `undefined` collapses
   *  TWO inhabitants (a projection deliberately unified because both real
   *  consumers render them identically):
   *    (a) NOTHING SELECTED — `active()` is `null` (kolu: never; drishti: the
   *        fleet grid, no host chosen). NO warning.
   *    (b) SELECTED-BUT-VANISHED — `active()` names a key that is NOT a current
   *        member: a removal race where the active host was removed and a
   *        fallback has not yet re-pointed `active`. This case ALSO emits a
   *        dev-mode `console.warn` naming the key — the runtime discriminator so
   *        a debugging consumer can tell a genuine no-selection from a transient
   *        vanish. If a consumer ever needs to branch on the two, that is the
   *        signal to switch this to a tagged return — come back, do not paper
   *        over it. */
  active: Accessor<T | undefined>;
  /** A background peek at ANY key's world WITHOUT making it active (e.g. W5
   *  attention rollups). NEVER creates an owner. `undefined` collapses two
   *  honest "no owned world here" cases: (a) NEVER-ACTIVATED — the key is (or
   *  was) a member but has not been made active, so no owner was lazily built;
   *  (b) NOT-A-MEMBER — the key is absent from `entries`. The distinction is not
   *  load-bearing for either consumer. */
  get(key: K): T | undefined;
}

/**
 * Scope per-key owned state by `entries` membership. Runs under the caller's
 * reactive owner (throws otherwise — it holds a keyArray of roots that must be
 * disposed with the app). `active` is app policy (nullable — `null` = nothing
 * selected). `build(key, ctx)` is invoked once per key on first activation, its
 * return value is the key's owned world, and everything it opens is torn down
 * when the key leaves membership.
 */
export function scopedByEntry<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Cause extends string,
  T,
>(
  client: SurfaceMapClient<KS, ES, Cause>,
  active: Accessor<z.infer<KS> | null>,
  build: (key: z.infer<KS>, ctx: { isActive: Accessor<boolean> }) => T,
): ScopedByEntry<z.infer<KS>, T> {
  type K = z.infer<KS>;

  requireOwner("scopedByEntry");

  const { enc, memberSet } = membershipKernel(client);

  // The ACTIVATED set — the keyArray source, and the single writer of owner
  // lifetime. A pure prev-accumulator memo (no signal writes): it keeps the keys
  // seen active that are still members, adds the current active member, and
  // returns the SAME array reference when nothing changed so keyArray never
  // churns. Enter-on-activation + prune-on-membership-exit = lazy, retained,
  // lazy-again-after-re-add. This lazy source is scopedByEntry's ONE difference
  // from watchByEntry (which feeds the full member set); the roots kernel below
  // is shared.
  const activated = createMemo<K[]>((prev) => {
    const a = active();
    const members = memberSet();
    const kept = prev.filter((k) => members.has(enc(k)));
    const encA = a === null ? null : enc(a);
    if (
      encA !== null &&
      members.has(encA) &&
      !kept.some((k) => enc(k) === encA)
    ) {
      return [...kept, a as K];
    }
    return kept.length === prev.length ? prev : kept;
  }, []);

  // A member is scoped by MEMBERSHIP, not connectedness: an entry that is
  // `warming` or `failed` still gets an owner once activated — its build may open
  // subscriptions that are themselves pending/failed, which is the entry's own
  // honest state, not a reason to withhold the owner.
  const index = keyedRoots<K, T>(enc, activated, (key) => {
    const encKey = enc(key);
    const isActive = createMemo(() => {
      const a = active();
      return a !== null && enc(a) === encKey;
    });
    return build(key, { isActive });
  });

  // The active-scope memo stays PURE: `null` (inhabitant a — nothing selected) and a
  // non-member key (inhabitant b — a removal race: the active host left the pool, a
  // fallback re-points `active` a tick later) BOTH resolve to `undefined` (honest
  // emptiness, not a throw). The dev-mode diagnostic for inhabitant (b) lives in the
  // effect below, NOT here — warning from inside a derivation fires on every unrelated
  // recompute (churn), rather than once when the state is entered.
  const activeScope: Accessor<T | undefined> = createMemo(() => {
    const a = active();
    return a === null ? undefined : index().get(enc(a));
  });

  // Dev-mode discriminator for inhabitant (b): warn ONCE per entry into "active()
  // names a non-member". `warnedFor` de-dupes — it fires when the state is entered (a
  // new non-member key), stays silent while it persists, and re-arms once `active`
  // resolves to a member (or null) again. `null` (inhabitant a) never warns.
  if (process.env.NODE_ENV !== "production") {
    let warnedFor: string | null = null;
    createEffect(() => {
      const a = active();
      if (a === null) {
        warnedFor = null;
        return;
      }
      const encA = enc(a);
      if (index().get(encA) !== undefined) {
        warnedFor = null;
        return;
      }
      if (warnedFor === encA) return;
      warnedFor = encA;
      console.warn(
        `scopedByEntry: active() names non-member ${encA} — no owned world this ` +
          "tick (a removal race; a fallback should re-point active). Returning undefined.",
      );
    });
  }

  const get = (key: K): T | undefined => index().get(enc(key));

  return { active: activeScope, get };
}

// ── watchByEntry — the eager attention watcher ────────────────────────────

/** A point read of a watched entry: its current value and whether the read is
 *  LIVE (our link to that host is up and it is connected) or STALE (link down —
 *  the last value is held, so a chip DIMS rather than lies). */
export interface WatchedValue<A> {
  readonly kind: "live" | "stale";
  readonly value: A;
}

/** The read-only bound cell a watcher consumes — the structural subset of
 *  `entry.cells.<name>` it needs: `.use()` yielding the current value and the raw
 *  `Subscription` (whose `updated` carries the change pairs). A real
 *  `ReadOnlyBoundCell<A>` (a get-only cell like `urgency`/`alerts`) satisfies it. */
export interface WatchableCell<A> {
  use(opts?: { onError?: (err: Error) => void }): {
    value: Accessor<A | undefined>;
    sub: Subscription<A>;
  };
}

export interface WatchByEntry<K, A> {
  /** A point read of a key's current watched value + liveness, or `undefined`
   *  when the key is not a member OR has no frame yet (a mirror stays silent
   *  until the authority speaks — see `@kolu/surface-remote`). Read inside a
   *  reactive scope; chips read this. There is deliberately NO `total()`:
   *  aggregation is APP policy (kolu sums awaiting terminals across live hosts;
   *  drishti counts hosts in trouble — a sum would be noise), so the watcher
   *  hands facts and each app folds. */
  get(key: K): WatchedValue<A> | undefined;
}

/**
 * Watch EVERY member's per-entry cell EAGERLY and fire `onRaise` for newly-raised
 * ids. The opposite laziness from `scopedByEntry` on the SAME membership kernel:
 * an attention watcher must be eager because a background host is precisely the
 * one you need to hear from.
 *
 * `cell` selects the per-entry cell (`e => e.cells.urgency`); `items` extracts
 * STABLE ids from its value (`v => v.awaitingIds`) — stability is the app's one
 * obligation, and what makes "same item, not a new one" decidable. Raise
 * detection is a pure SET-DIFF over the framework's `updated` `{prev, next}`
 * pairs: `items(next) ∖ items(prev)` are the newly-raised ids. That one line is
 * the payoff of the completed Dynamic — no hand-held previous frame, no frame
 * classification, no per-window memory: the change-iff-fired law upstream is what
 * makes a plain set-diff trustworthy.
 *
 * Runs under the caller's reactive owner (throws otherwise — it holds a keyArray
 * of per-key roots). Everything a key opens (its cell subscription, its `updated`
 * registration) tears down when the key leaves membership.
 */
export function watchByEntry<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Cause extends string,
  A,
  // Ids are `PropertyKey` (string / number / symbol), never objects: raise
  // detection is a `Set` diff, and object ids — reconstructed fresh from each
  // wire frame — would compare by REFERENCE and re-raise every frame. Constrain
  // it so an object-id `items` is a compile error, not a silent every-frame
  // storm.
  I extends PropertyKey,
>(
  client: SurfaceMapClient<KS, ES, Cause>,
  cell: (entry: Entry<ES, Cause>) => WatchableCell<A>,
  items: (value: A) => I[],
  onRaise: (key: z.infer<KS>, raised: I[], value: A) => void,
  opts?: {
    /** Called when a watched entry's cell subscription ERRORS. Without this a
     *  per-host cell failure would only dim the point read to `stale` (the badge
     *  stops counting it) and otherwise VANISH — no log, no user surface. Defaults
     *  to a stderr log (like `deriveCell`) so a failure is never invisible; pass a
     *  handler to route it to a toast/health surface, or `() => {}` to opt into
     *  silent-dim deliberately. This is the app's error CHANNEL — distinct from the
     *  live/stale point read, matching the map API's other `use({ onError })` seams
     *  rather than fattening `WatchedValue` with an error arm. */
    onError?: (key: z.infer<KS>, err: Error) => void;
  },
): WatchByEntry<z.infer<KS>, A> {
  type K = z.infer<KS>;

  requireOwner("watchByEntry");

  const { enc, memberKeys } = membershipKernel(client);

  const onError =
    opts?.onError ??
    ((key: K, err: Error): void => {
      console.error(
        `watchByEntry: watched cell subscription errored for key ${String(enc(key))}`,
        err,
      );
    });

  // EAGER: the source is the FULL member set, so every host gets a root the moment
  // it joins — a background host is subscribed and heard from without ever being
  // activated. (scopedByEntry feeds `activated` here instead; the kernel is one.)
  const index = keyedRoots<
    K,
    { value: Accessor<A | undefined>; live: Accessor<boolean> }
  >(enc, memberKeys, (key) => {
    const entry = client.entry(key);
    // Route this entry's subscription error to the app's `onError` channel (default
    // logs) so a per-host cell failure is never invisible — the `live` memo below
    // dims the point read to `stale`, but the FAILURE itself surfaces here.
    const { value, sub } = cell(entry).use({
      onError: (err) => onError(key, err),
    });
    // Raise detection RIDES `updated` (the change-iff-fired law) — a watcher with
    // no change channel would silently return values and never raise, defeating
    // its one job. Fail fast rather than degrade: a watched cell MUST be minted by
    // the surface factories (they always populate `updated`); optional chaining
    // here would swallow the contract.
    if (!sub.updated) {
      throw new Error(
        "watchByEntry: the watched cell's subscription has no `updated` — a watcher " +
          "needs the change-iff-fired channel to detect raised ids. Select a cell " +
          "minted by the surface factories (`entry.cells.<name>`), not a hand-assembled one.",
      );
    }
    // Raise detection: a pure set-diff over the framework's honest change pairs.
    // Dedupe `next`'s ids first (`Set` on `PropertyKey`) so a frame that repeats
    // an id can't raise it twice.
    const off = sub.updated(({ prev, next }) => {
      const before = new Set<I>(items(prev));
      const raised = [...new Set<I>(items(next))].filter(
        (id) => !before.has(id),
      );
      if (raised.length > 0) onRaise(key, raised, next);
    });
    onCleanup(off);
    // Point reads answer honestly. A value is LIVE only when the host link is up
    // (`state().kind === "connected"`; foldState downgrades a stale `connected` to
    // `warming`) AND this cell's own subscription is neither errored nor ended —
    // urgency is not a `liveWhen` gate, so an errored/completed cell would NOT
    // downgrade `entry.state()`, and reporting its frozen value as `live` would
    // let a consumer count stale urgency. A cell in that state reads STALE (its
    // last value dims) rather than lying live.
    const live = createMemo(
      () =>
        entry.state().kind === "connected" &&
        !sub.error() &&
        !(sub.complete?.() ?? false),
    );
    return { value, live };
  });

  const get = (key: K): WatchedValue<A> | undefined => {
    const world = index().get(enc(key));
    if (!world) return undefined;
    const v = world.value();
    if (v === undefined) return undefined; // no frame yet — the mirror is silent
    return { kind: world.live() ? "live" : "stale", value: v };
  };

  return { get };
}
