import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { hostReconcileTarget } from "./hostReconcile.ts";

const zest: HostKey = { kind: "remote", target: "zest" };
const west: HostKey = { kind: "remote", target: "west" };

describe("hostReconcileTarget — departed-bounce arm (RS4 #4)", () => {
  it("departed active guest → bounce to the local default", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, west], zest, null, LOCAL_HOST),
    ).toEqual({ kind: "bounce-departed", target: LOCAL_HOST });
  });

  it("warming window (no membership snapshot yet) → no-op", () => {
    expect(hostReconcileTarget([], zest, null, LOCAL_HOST)).toBeNull();
  });

  it("active host still a member → no-op", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], zest, null, LOCAL_HOST),
    ).toBeNull();
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
    expect(
      hostReconcileTarget([LOCAL_HOST, west], west, zest, LOCAL_HOST),
    ).toBeNull();
  });

  it("join wins over a concurrent departed-bounce", () => {
    expect(
      hostReconcileTarget([LOCAL_HOST, zest], west, zest, LOCAL_HOST),
    ).toEqual({ kind: "activate-joined", target: zest });
  });

  it("pending not a member AND active departed → bounce, pending survives for a later join", () => {
    expect(hostReconcileTarget([LOCAL_HOST], west, zest, LOCAL_HOST)).toEqual({
      kind: "bounce-departed",
      target: LOCAL_HOST,
    });
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

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
    const h = harness({ members: [LOCAL_HOST, west], active: west });
    await tick();

    h.setActiveHost(zest);
    await tick();
    expect(h.activeHost()).toEqual(LOCAL_HOST);

    h.setMembers([LOCAL_HOST, west, zest]);
    await tick();
    expect(h.activeHost()).toEqual(LOCAL_HOST);
    h.dispose();
  });

  it("THE FIX: requestActivateOnJoin defers the switch until the host joins — lands on the NEW host", async () => {
    const h = harness({ members: [LOCAL_HOST, west], active: west });
    await tick();

    h.requestActivateOnJoin(zest);
    await tick();
    expect(h.activeHost()).toEqual(west);

    h.setMembers([LOCAL_HOST, west, zest]);
    await tick();
    expect(h.activeHost()).toEqual(zest);
    h.dispose();
  });
});
