/**
 * `scopedByEntry` — the ownership contract, pinned end-to-end over the in-process
 * map harness. Proves the ratified lifetime (lazy · retained · membership-tied),
 * both coordinator amendments (lazy-again-after-re-add; the remove-active-host
 * race resolves to undefined + a dev warning, never a throw), and the P4
 * conditions (the two inhabitants of `undefined`; a failed/warming member still
 * gets an owner because MEMBERSHIP — not connectedness — is the authority).
 */

import { createRoot, createSignal, onCleanup } from "solid-js";
import { describe, expect, it, vi } from "vitest";
// Imported from the PUBLIC client entrypoint — also proves the re-export wiring.
import { scopedByEntry } from "./client";
import {
  A,
  B,
  C,
  connected,
  type HostKey,
  makeEntry,
  settle,
  setup,
} from "./mapHarness.testlib";

/** A `build` that records every owner it constructs and disposes, and hands each
 *  owner its `isActive` accessor — so a test can assert lazy/retain/dispose by
 *  counting builds and watching `onCleanup`. */
function trackingBuild() {
  const builds: HostKey[] = [];
  const disposed: HostKey[] = [];
  const build = (key: HostKey, ctx: { isActive: () => boolean }) => {
    builds.push(key);
    onCleanup(() => disposed.push(key));
    return { key, isActive: ctx.isActive };
  };
  return { build, builds, disposed };
}

const link = () => makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch;

describe("scopedByEntry — per-key ownership by entries membership", () => {
  it("(1) lazy: a member is not built until it is first activated", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const [active, setActive] = createSignal<HostKey | null>(null);
      const { build, builds } = trackingBuild();
      const scoped = scopedByEntry(client, active, build);

      addSession(A, link(), connected(0));
      addSession(B, link(), connected(0));
      await settle();

      // Both are members, but nothing was activated → no owner built (lazy).
      expect(builds).toEqual([]);
      expect(scoped.get(A)).toBeUndefined();
      expect(scoped.get(B)).toBeUndefined();
      expect(scoped.active()).toBeUndefined(); // active() === null

      setActive(A);
      await settle();

      // Only A got an owner — B stays lazy (a background member costs nothing).
      expect(builds).toEqual([A]);
      expect(scoped.get(A)).toBeDefined();
      expect(scoped.get(B)).toBeUndefined();
      expect(scoped.active()?.key).toEqual(A);
      dispose();
    });
  });

  it("(2) retained across switch-away/back; only the active owner is isActive", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const [active, setActive] = createSignal<HostKey | null>(null);
      const { build, builds } = trackingBuild();
      const scoped = scopedByEntry(client, active, build);

      addSession(A, link(), connected(0));
      addSession(B, link(), connected(0));
      await settle();

      setActive(A);
      await settle();
      const ownerA = scoped.get(A);
      expect(scoped.get(A)?.isActive()).toBe(true);

      setActive(B);
      await settle();
      expect(builds).toEqual([A, B]); // B built on ITS first activation
      expect(scoped.get(A)?.isActive()).toBe(false); // A retained but inactive
      expect(scoped.get(B)?.isActive()).toBe(true);
      expect(scoped.active()?.key).toEqual(B);

      setActive(A);
      await settle();
      expect(builds).toEqual([A, B]); // A NOT rebuilt — retained across switch-away
      expect(scoped.get(A)).toBe(ownerA); // same owner instance
      expect(scoped.get(A)?.isActive()).toBe(true);
      dispose();
    });
  });

  it("(3) disposed on membership exit; a retained sibling is untouched", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, remove } = setup();
      const [active, setActive] = createSignal<HostKey | null>(null);
      const { build, disposed } = trackingBuild();
      const scoped = scopedByEntry(client, active, build);

      addSession(A, link(), connected(0));
      addSession(B, link(), connected(0));
      await settle();
      setActive(A);
      await settle();
      setActive(B);
      await settle(); // both A and B now have owners

      setActive(A); // look away from B before B leaves — no removal race
      await settle();
      remove(B);
      await settle();

      expect(disposed).toEqual([B]); // B's owner torn down on membership exit
      expect(scoped.get(B)).toBeUndefined();
      expect(scoped.get(A)).toBeDefined(); // A untouched
      dispose();
    });
  });

  it("(4) lazy again after re-add — a removed host is a FRESH member (R2 amendment)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, remove } = setup();
      const [active, setActive] = createSignal<HostKey | null>(null);
      const { build, builds, disposed } = trackingBuild();
      const scoped = scopedByEntry(client, active, build);

      addSession(A, link(), connected(0));
      addSession(B, link(), connected(0));
      await settle();
      setActive(A);
      await settle();
      const firstOwnerA = scoped.get(A);

      // Look away from A, then remove it: it leaves membership AND the activated set.
      setActive(B);
      await settle();
      remove(A);
      await settle();
      expect(disposed).toEqual([A]);
      expect(scoped.get(A)).toBeUndefined();

      // Re-add A as a member WITHOUT activating it (active is still B).
      addSession(A, link(), connected(0));
      await settle();
      expect(builds).toEqual([A, B]); // NOT rebuilt from a stale activated entry
      expect(scoped.get(A)).toBeUndefined(); // absent until the NEXT activation

      // Now activate it — a fresh owner is built (a genuinely new instance).
      setActive(A);
      await settle();
      expect(builds).toEqual([A, B, A]); // built again, fresh
      expect(scoped.get(A)).toBeDefined();
      expect(scoped.get(A)).not.toBe(firstOwnerA);
      dispose();
    });
  });

  it("(5) R3: null → undefined (no warn); non-member active → undefined + dev warn; fallback resolves", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await createRoot(async (dispose) => {
        const { client, addSession, remove } = setup();
        const [active, setActive] = createSignal<HostKey | null>(null);
        const { build } = trackingBuild();
        const scoped = scopedByEntry(client, active, build);

        addSession(A, link(), connected(0));
        addSession(B, link(), connected(0));
        await settle();

        // (a) nothing selected — undefined, and NO warning.
        expect(scoped.active()).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();

        setActive(A);
        await settle();
        expect(scoped.active()?.key).toEqual(A);

        // (b) remove the ACTIVE host — active() names a non-member for a tick.
        remove(A);
        await settle();
        expect(scoped.active()).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("non-member");
        expect(String(warn.mock.calls[0]?.[0])).toContain(String(A));

        // The fallback re-points active to a live member → resolves.
        setActive(B);
        await settle();
        expect(scoped.active()?.key).toEqual(B);
        dispose();
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("(6) get() is total; a failed/warming member still gets an owner (membership, not connectedness)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, addFault } = setup();
      const [active, setActive] = createSignal<HostKey | null>(null);
      const { build } = trackingBuild();
      const scoped = scopedByEntry(client, active, build);

      // never-a-member → undefined (the not-a-member inhabitant of get()).
      expect(scoped.get(C)).toBeUndefined();

      // A member that is only `connecting` (projects to `warming`) is still a
      // MEMBER, so it gets an owner once activated — scoping is by membership.
      addSession(A, link(), { kind: "connecting" });
      await settle();
      setActive(A);
      await settle();
      expect(scoped.get(A)).toBeDefined();

      // A structurally faulted member (`failed`, no session) is likewise a MEMBER
      // (it appears in `entries`), so it too gets an owner on activation — a scope
      // is withheld only for a NON-member, never for a member that isn't connected.
      addFault(B, { cause: "drv-missing", reason: "no drv for arch" });
      await settle();
      setActive(B);
      await settle();
      expect(scoped.get(B)).toBeDefined();
      dispose();
    });
  });

  it("(7) throws when constructed outside a reactive owner", () => {
    const [active] = createSignal<HostKey | null>(null);
    // Build a real client inside a root, then let it escape — scopedByEntry is
    // then called at test scope with NO owner, exactly the misuse being pinned
    // (its owner-check fires before the client is ever touched).
    const client = createRoot((d) => {
      const c = setup().client;
      d();
      return c;
    });
    expect(() => scopedByEntry(client, active, (k) => k)).toThrow(
      /reactive owner/,
    );
  });
});
