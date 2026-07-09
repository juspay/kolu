import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { hostReconcileTarget } from "./hostReconcile.ts";

const zest: HostKey = { kind: "remote", target: "zest" };
const west: HostKey = { kind: "remote", target: "west" };

// The ONE active-host reconcile decision (wire.ts). Pins both arms: the RS4 #4 departed-bounce
// (a departed ACTIVE host falls back to local, while warming / still-a-member / local-default
// stay no-ops) AND the W6 add-host join-activation (a just-added host becomes active the frame
// it joins membership — not the moment `hosts.add` resolves).
describe("hostReconcileTarget — departed-bounce arm (RS4 #4)", () => {
  it("departed active guest → bounce to the local default", () => {
    // active 'zest' was removed (✕ or server auto-retire); membership no longer holds it.
    expect(
      hostReconcileTarget([LOCAL_HOST, west], zest, null, LOCAL_HOST),
    ).toEqual({ kind: "bounce-departed", target: LOCAL_HOST });
  });

  it("warming window (no membership snapshot yet) → no-op", () => {
    // Before the first entries frame, an empty keyset must NOT read the active host as
    // departed (else every boot would bounce to local before the pool has published).
    expect(hostReconcileTarget([], zest, null, LOCAL_HOST)).toBeNull();
  });

  it("active host still a member → no-op", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], zest, null, LOCAL_HOST),
    ).toBeNull();
    // Membership compares by ENCODED value, not object reference — a freshly-decoded
    // `zest` (a different object) still matches.
    expect(
      hostReconcileTarget(
        [LOCAL_HOST, { kind: "remote", target: "zest" }],
        { kind: "remote", target: "zest" },
        null,
        LOCAL_HOST,
      ),
    ).toBeNull();
  });

  it("active host is the local default → no-op (unremovable, always a member)", () => {
    // Even a (spurious) keyset missing the local default must not bounce off it.
    expect(
      hostReconcileTarget([west], LOCAL_HOST, null, LOCAL_HOST),
    ).toBeNull();
  });
});

describe("hostReconcileTarget — join-activation arm (W6 add-host fix)", () => {
  it("pending host now a member → activate it (consume the intent)", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], LOCAL_HOST, zest, LOCAL_HOST),
    ).toEqual({ kind: "activate-joined", target: zest });
  });

  it("pending host NOT yet a member → no-op (never bounces off the current active host)", () => {
    // The whole point: while the added host is still on its way in, the tab must NOT be
    // yanked to local (the pre-fix bug) — it holds on the current active host.
    expect(
      hostReconcileTarget([LOCAL_HOST, west], west, zest, LOCAL_HOST),
    ).toBeNull();
  });

  it("join wins over a concurrent departed-bounce", () => {
    // active 'west' departed AND the pending 'zest' just joined in the same frame → the
    // join intent takes precedence (activate zest), not a bounce to local.
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], west, zest, LOCAL_HOST),
    ).toEqual({ kind: "activate-joined", target: zest });
  });

  it("pending not a member AND active departed → bounce, pending survives for a later join", () => {
    // 'west' departed and 'zest' hasn't joined yet: bounce to local now; the caller keeps
    // the pending intent so 'zest' still activates once it lands.
    expect(hostReconcileTarget([LOCAL_HOST], west, zest, LOCAL_HOST)).toEqual({
      kind: "bounce-departed",
      target: LOCAL_HOST,
    });
  });
});

/** Let SolidJS flush the queued reactive effects — they don't run inside the synchronous
 *  `createRoot` batch; after this, out-of-batch signal writes flush the effect. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** wire.ts's ONE host-scope reconcile effect, over signals: the `members`/`activeHost`/
 *  `pendingJoin` state and the single effect that enacts `hostReconcileTarget`. The
 *  add-flow's `requestActivateOnJoin` is `setPendingJoin`. */
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
    const [pendingJoin, setPendingJoin] = createSignal<HostKey | null>(null);
    createEffect(() => {
      const action = hostReconcileTarget(
        members(),
        activeHost(),
        pendingJoin(),
        LOCAL_HOST,
      );
      if (action === null) return;
      if (action.kind === "activate-joined") setPendingJoin(null);
      setActiveHost(action.target);
    });
    handles = {
      setMembers,
      setActiveHost,
      activeHost,
      requestActivateOnJoin: setPendingJoin,
      dispose,
    };
  });
  return handles;
}

describe("add-host activation vs. the membership reconcile (folded repro — ONE effect)", () => {
  it("BUG shape: switching to a just-added host IMMEDIATELY is bounced to local by the reconcile", async () => {
    // Documents WHY the naive add-`.then` fix failed: a bare setActiveHost, before the
    // member is observable, is a departed-bounce input to the very same reconcile.
    const h = harness({ members: [LOCAL_HOST, west], active: west });
    await tick();

    h.setActiveHost(zest); // not a member yet
    await tick();
    expect(h.activeHost()).toEqual(LOCAL_HOST); // bounced

    h.setMembers([LOCAL_HOST, west, zest]); // membership catches up, but nothing re-activates
    await tick();
    expect(h.activeHost()).toEqual(LOCAL_HOST);
    h.dispose();
  });

  it("THE FIX: requestActivateOnJoin defers the switch until the host joins — lands on the NEW host", async () => {
    const h = harness({ members: [LOCAL_HOST, west], active: west });
    await tick();

    h.requestActivateOnJoin(zest); // the fixed add flow: pending intent
    await tick();
    expect(h.activeHost()).toEqual(west); // not a member yet → NOT activated, NOT bounced

    h.setMembers([LOCAL_HOST, west, zest]); // membership delivers it
    await tick();
    expect(h.activeHost()).toEqual(zest); // now active — the N+1th host, not local
    h.dispose();
  });
});
