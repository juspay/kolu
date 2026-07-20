import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { groundActiveHost } from "./groundActive.ts";

const zest: HostKey = { kind: "remote", target: "zest" };
const west: HostKey = { kind: "remote", target: "west" };

// `groundActiveHost` — the pure grounding decision wire.ts's `groundedActiveHost`
// enacts: the active host IFF it is a current member, else `null` (the scope's honest
// no-selection inhabitant). Pins the boot window (empty membership → null, so a fresh
// tab never hands the per-host scope an ungrounded active), the grounded case, the
// departed case (→ null, NOT a substituted local world), and encode-equality.
describe("groundActiveHost — ground the active host against membership", () => {
  it("boot window: membership not snapshotted yet → null (no ungrounded active)", () => {
    // active restored sync from the launch-selected storage (sessionStorage for a tab,
    // localStorage for an installed PWA) before the first entries frame — the #1763
    // transient. `null` is `scopedByEntry`'s no-warn no-selection inhabitant.
    expect(groundActiveHost(LOCAL_HOST, [])).toBeNull();
    expect(groundActiveHost(zest, [])).toBeNull();
  });

  it("active host is a current member → the active host (grounded)", () => {
    expect(groundActiveHost(LOCAL_HOST, [LOCAL_HOST])).toEqual(LOCAL_HOST);
    expect(groundActiveHost(zest, [LOCAL_HOST, zest])).toEqual(zest);
  });

  it("active host is NOT a member (departed / never-joined) → null, never a local substitute", () => {
    // `zest` was persisted from a prior session but is not in the current pool. The
    // scope must read `null` (nothing grounded), NOT local's world — wire.ts's reconcile
    // re-points `activeHost` to local a tick later. Substituting local here would paint
    // local's owned world under a non-local `activeHost` — a representable lie.
    expect(groundActiveHost(zest, [LOCAL_HOST])).toBeNull();
    expect(groundActiveHost(zest, [LOCAL_HOST, west])).toBeNull();
  });

  it("membership is ENCODE-equality, not object identity", () => {
    // A freshly-decoded `zest` (a different object) still grounds against membership's
    // own `zest` — a HostKey has no reference identity across independent decodes.
    expect(
      groundActiveHost({ kind: "remote", target: "zest" }, [
        LOCAL_HOST,
        { kind: "remote", target: "zest" },
      ]),
    ).toEqual(zest);
  });
});
