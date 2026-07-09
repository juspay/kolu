/**
 * The add-host → activate flow, and its race with wire.ts's membership reconcile.
 *
 * THE BUG (regression in the "activate a newly added host" change): `hosts.add` resolves
 * BEFORE the membership `entries` stream delivers the new member, so switching to the host
 * immediately (in the add `.then`) loses a race with wire.ts's reconcile effect
 * (`hostReconcileTarget`), which sees the just-activated host as "not a member" and bounces
 * the tab to the unremovable LOCAL default. Net effect a user sees: adding their N+1th host
 * always lands on the LOCAL host, never the one they just added.
 *
 * These tests harness the REAL reconcile decision (`hostReconcileTarget`) over signals,
 * wired exactly as `wire.ts` wires it (an effect that reverts a non-member active host to
 * local), so the reproduction exercises the true failure mode — not a mock of it.
 */

import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createAddedHostActivation } from "./hostAddActivation";
import { hostReconcileTarget } from "./hostReconcile";

const remoteA: HostKey = { kind: "remote", target: "srid@boxA" };
const newHost: HostKey = { kind: "remote", target: "srid@boxB" };

/** Let SolidJS flush the queued reactive effects — they don't run inside the synchronous
 *  `createRoot` batch; after this, out-of-batch signal writes flush the effects. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A faithful stand-in for wire.ts's host-scope owner: the `members`/`activeHost` signals,
 *  the REAL membership reconcile effect, and the add-activation seam under test. */
function harness(init: { members: HostKey[]; active: HostKey }) {
  let handles!: {
    setMembers: (v: HostKey[]) => void;
    setActiveHost: (v: HostKey) => void;
    activeHost: () => HostKey;
    requestActivateOnJoin: (h: HostKey) => void;
    dispose: () => void;
  };
  createRoot((dispose) => {
    const [members, setMembers] = createSignal<HostKey[]>(init.members);
    const [activeHost, setActiveHost] = createSignal<HostKey>(init.active);
    // wire.ts's membership reconcile, verbatim in shape: a departed (non-member) active
    // host falls back to the local default.
    createEffect(() => {
      const target = hostReconcileTarget(members(), activeHost(), LOCAL_HOST);
      if (target !== null) setActiveHost(target);
    });
    const requestActivateOnJoin = createAddedHostActivation(
      () => members(),
      setActiveHost,
    );
    handles = {
      setMembers,
      setActiveHost,
      activeHost,
      requestActivateOnJoin,
      dispose,
    };
  });
  return handles;
}

describe("add-host activation vs. the membership reconcile", () => {
  it("REPRODUCES THE BUG: activating a just-added host IMMEDIATELY is reverted to local", async () => {
    // N existing hosts (local + one remote); the remote is active.
    const h = harness({ members: [LOCAL_HOST, remoteA], active: remoteA });
    await tick();

    // The buggy add flow: switch to the newly added host at once, before the membership
    // `entries` stream has delivered it (the `hosts.add` `.then` resolves first).
    h.setActiveHost(newHost);
    await tick();

    // The reconcile fired on the stale membership and bounced the tab to local.
    expect(h.activeHost()).toEqual(LOCAL_HOST);

    // Membership catches up with the new host — but nothing re-activates it.
    h.setMembers([LOCAL_HOST, remoteA, newHost]);
    await tick();
    expect(h.activeHost()).toEqual(LOCAL_HOST); // the N+1th host never becomes active
    h.dispose();
  });

  it("THE FIX: requestActivateOnJoin defers the switch until the host joins — lands on the NEW host", async () => {
    const h = harness({ members: [LOCAL_HOST, remoteA], active: remoteA });
    await tick();

    // The fixed add flow asks to activate the host once it JOINS the pool.
    h.requestActivateOnJoin(newHost);
    await tick();

    // Not a member yet → NOT activated, and — crucially — the reconcile did NOT bounce
    // the tab to local (the active host is still the previously-active remote).
    expect(h.activeHost()).toEqual(remoteA);

    // Membership delivers the new host → NOW it becomes active.
    h.setMembers([LOCAL_HOST, remoteA, newHost]);
    await tick();
    expect(h.activeHost()).toEqual(newHost);
    h.dispose();
  });

  it("activates immediately when the added host is ALREADY a member (a re-add / the local default)", async () => {
    // Adding a host that is already in the pool: the join condition holds at once, so the
    // switch happens on the next frame with no revert.
    const h = harness({ members: [LOCAL_HOST, remoteA], active: LOCAL_HOST });
    await tick();

    h.requestActivateOnJoin(remoteA);
    await tick();
    expect(h.activeHost()).toEqual(remoteA);
    h.dispose();
  });
});
