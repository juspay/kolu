import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { groundActiveHost } from "./groundActive.ts";

const zest: HostKey = { kind: "remote", target: "zest" };
const west: HostKey = { kind: "remote", target: "west" };

describe("groundActiveHost — ground the active host against membership", () => {
  it("boot window: membership not snapshotted yet → null (no ungrounded active)", () => {
    expect(groundActiveHost(LOCAL_HOST, [])).toBeNull();
    expect(groundActiveHost(zest, [])).toBeNull();
  });

  it("active host is a current member → the active host (grounded)", () => {
    expect(groundActiveHost(LOCAL_HOST, [LOCAL_HOST])).toEqual(LOCAL_HOST);
    expect(groundActiveHost(zest, [LOCAL_HOST, zest])).toEqual(zest);
  });

  it("active host is NOT a member (departed / never-joined) → null, never a local substitute", () => {
    expect(groundActiveHost(zest, [LOCAL_HOST])).toBeNull();
    expect(groundActiveHost(zest, [LOCAL_HOST, west])).toBeNull();
  });

  it("membership is ENCODE-equality, not object identity", () => {
    expect(
      groundActiveHost({ kind: "remote", target: "zest" }, [
        LOCAL_HOST,
        { kind: "remote", target: "zest" },
      ]),
    ).toEqual(zest);
  });
});
