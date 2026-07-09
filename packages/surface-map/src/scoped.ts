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
import { keyArray } from "@solid-primitives/keyed";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRenderEffect,
  getOwner,
} from "solid-js";
import type { z } from "zod";
import type { SurfaceMapClient } from "./client";

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

  if (!getOwner()) {
    throw new Error(
      "scopedByEntry must run under a reactive owner — it owns a keyArray of " +
        "per-key roots disposed on membership exit, and would leak them " +
        "otherwise. Call it inside a component / createRoot / the app-root owner.",
    );
  }

  // The ONE identity authority: every key becomes its canonical wire string
  // through the map's own codec. We cannot compare keys by `===` — membership
  // keys are canonicalized in the map client's cache while `active()` may arrive
  // from a SEPARATE decode (kolu's `HostKey` cache), so two logically-equal keys
  // need not be reference-equal. String identity side-steps that entirely.
  const enc = (key: K): string => client.codec.encode(key);

  // The membership view — opened ONCE (a second `.use()` is a second wire
  // subscription). `entries` is the SOLE disposal authority.
  const entriesView = client.entries.use();
  const memberSet = createMemo(() => new Set(entriesView.keys().map(enc)));

  // The ACTIVATED set — the keyArray source, and the single writer of owner
  // lifetime. A pure prev-accumulator memo (no signal writes): it keeps the keys
  // seen active that are still members, adds the current active member, and
  // returns the SAME array reference when nothing changed so keyArray never
  // churns. Enter-on-activation + prune-on-membership-exit = lazy, retained,
  // lazy-again-after-re-add.
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

  // keyArray: retained-per-key-root. A key's root (and everything `build` opens
  // inside it) persists while the key stays in `activated`, disposed the moment
  // it leaves. A member is scoped by MEMBERSHIP, not connectedness: an entry that
  // is `warming` or `failed` still gets an owner once activated — its build may
  // open subscriptions that are themselves pending/failed, which is the entry's
  // own honest state, not a reason to withhold the owner.
  const scopes = keyArray(activated, enc, (item): T => {
    const key = item(); // stable within this key's retained root
    const encKey = enc(key);
    const isActive = createMemo(() => {
      const a = active();
      return a !== null && enc(a) === encKey;
    });
    return build(key, { isActive });
  });

  // Eager pin (the `createKeyedRoot` house style): read the keyed list in a
  // render effect so a key's build/dispose happens SYNCHRONOUSLY on an
  // activation/membership change — before any consumer reads `active()` — never
  // lazily on the next read (a one-frame empty owner on a first switch would be
  // exactly the blank-canvas class W7 removes).
  createRenderEffect(() => void scopes());

  // enc → owned world, aligned with `activated`. The lookup index both accessors
  // read.
  const index = createMemo(() => {
    const keys = activated();
    const built = scopes();
    const m = new Map<string, T>();
    // keyArray returns owners aligned 1:1 with `keys`, so `built[i]` is present.
    keys.forEach((key, i) => {
      m.set(enc(key), built[i] as T);
    });
    return m;
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
