import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { createEffect, createRoot, createSignal, untrack } from "solid-js";
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

/** Let Solid run the queued effects. A write is staged and its subscribers run at the
 *  next microtask checkpoint, so each step of a scenario awaits one before asserting. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** wire.ts's ONE host-scope reconcile effect, over signals: the `members`/`activeHost`/
 *  join-request state and the single effect that enacts `hostReconcileTarget`. The
 *  add-flow's `requestActivateOnJoin` raises a SEQUENCED request, and the effect records
 *  the sequence it served in a plain variable — exactly wire.ts's shape, and for its
 *  reason: consuming the intent by clearing a signal the compute reads made the effect
 *  write its own source (EFFECT_WRITES_OWN_SOURCE), and the active host is the SUBJECT of
 *  the decision, so it is read once per pass UNTRACKED rather than triggering the pass. */
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
    type JoinRequest = { host: HostKey; seq: number };
    let joinSeq = 0;
    let servedJoinSeq = 0;
    const [joinRequest, setJoinRequest] = createSignal<JoinRequest | null>(
      null,
    );
    createEffect(
      () => {
        const request = joinRequest();
        const pending =
          request !== null && request.seq > servedJoinSeq ? request : null;
        return {
          request: pending,
          action: hostReconcileTarget(
            members(),
            untrack(activeHost),
            pending?.host ?? null,
            LOCAL_HOST,
          ),
        };
      },
      ({ action, request }) => {
        if (action === null) return;
        if (action.kind === "activate-joined" && request !== null)
          servedJoinSeq = request.seq;
        setActiveHost(action.target);
      },
    );
    handles = {
      setMembers,
      setActiveHost,
      activeHost,
      requestActivateOnJoin: (host) => setJoinRequest({ host, seq: ++joinSeq }),
      dispose,
    };
  });
  return handles;
}

describe("add-host activation vs. the membership reconcile (folded repro — ONE effect)", () => {
  it("a switch to a host that has not joined yet is left alone — the reconcile answers to MEMBERSHIP", async () => {
    // The active host is the decision's subject, not its trigger (wire.ts reads it
    // untracked), so a bare `setActiveHost` no longer re-enters the reconcile. The
    // add flow still needs `requestActivateOnJoin` for its own reason: until the
    // member is observable, nothing lists or lights the host it lands on.
    const h = harness({ members: [LOCAL_HOST, west], active: west });
    await tick();

    h.setActiveHost(zest); // not a member yet
    await tick();
    expect(h.activeHost()).toEqual(zest); // not bounced by the switch itself

    // A membership frame that still does not hold it IS the departed input, and
    // that is what bounces.
    h.setMembers([LOCAL_HOST, west]);
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

    // The served request is consumed by SEQUENCE, not by a write the compute reads:
    // a later membership frame must not yank the user back to it.
    h.setActiveHost(west);
    h.setMembers([LOCAL_HOST, west, zest]);
    await tick();
    expect(h.activeHost()).toEqual(west);
    h.dispose();
  });
});
