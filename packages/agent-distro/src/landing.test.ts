/** The set a host serves, padi's record of it, and how a landing is worded in
 *  the history log. */

import { describe, expect, it } from "vitest";
import {
  type DeliveredProfile,
  type DeliveredSet,
  deliveryChanges,
  parseDeliveredSet,
  profileBuildLabel,
  referencesOf,
  sameStack,
} from "./landing.ts";

const PKG_A = "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro";
const PKG_B = "/nix/store/8rcmf6rdyyyyyyyyyyyyyyyyyyyyyyyy-agent-distro";

const JUSPAY: DeliveredProfile = {
  reference: "github:juspay/skills",
  name: "juspay",
  rev: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  path: "/nix/store/jjjjjjjj1111111111111111111111-profile-juspay",
};
const JUSPAY_NEXT: DeliveredProfile = {
  ...JUSPAY,
  rev: "d4e5f6a7b8c90011223344556677889900aabbcc",
  path: "/nix/store/kkkkkkkk2222222222222222222222-profile-juspay",
};
/** A path reference: used as it is, so it has no revision. */
const EKALA: DeliveredProfile = {
  reference: "~/ekala",
  name: "ekala",
  path: "/nix/store/9f8e7d6c3333333333333333333333-profile-ekala",
};

const V1 = [
  { name: "claude", title: "Claude Code", version: "2.0.1" },
  { name: "pi", title: "Pi", version: "1.0.3" },
];
const V2 = [
  { name: "claude", title: "Claude Code", version: "2.0.3" },
  { name: "pi", title: "Pi", version: "1.0.3" },
];

const set = (bundle: string, profiles: DeliveredProfile[]): DeliveredSet => ({
  bundle,
  profiles,
});

describe("parseDeliveredSet", () => {
  it("reads padi's record back, in stack order", () => {
    const s = set(PKG_A, [JUSPAY, EKALA]);
    expect(parseDeliveredSet(JSON.stringify(s))).toEqual(s);
  });
  it("throws on any other shape — padi wrote it, so another is a broken file", () => {
    expect(() => parseDeliveredSet("{")).toThrow();
    expect(() =>
      parseDeliveredSet(JSON.stringify({ bundle: "", profiles: [] })),
    ).toThrow();
    expect(() =>
      parseDeliveredSet(
        JSON.stringify({ bundle: PKG_A, profiles: [{ name: "juspay" }] }),
      ),
    ).toThrow();
  });
});

describe("sameStack and referencesOf", () => {
  it("compares references in order — a reordered stack is another stack", () => {
    expect(sameStack([], [])).toBe(true);
    expect(sameStack(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameStack(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameStack(["a"], ["a", "b"])).toBe(false);
  });
  it("names a delivered stack's references", () => {
    expect(referencesOf([JUSPAY, EKALA])).toEqual([
      "github:juspay/skills",
      "~/ekala",
    ]);
  });
});

describe("profileBuildLabel", () => {
  it("a locked revision, shortened as git does — else the store hash", () => {
    expect(profileBuildLabel(JUSPAY)).toBe("a1b2c3d");
    expect(profileBuildLabel(EKALA)).toBe("9f8e7d6c");
  });
});

describe("deliveryChanges — a landing in the history log's words", () => {
  it("a first landing names every harness and every profile", () => {
    expect(
      deliveryChanges(undefined, {
        set: set(PKG_A, [JUSPAY, EKALA]),
        versions: V1,
      }),
    ).toBe("Claude Code 2.0.1, Pi 1.0.3, juspay a1b2c3d, ekala 9f8e7d6c");
  });

  it("a package-only change is upstream's words for its harnesses alone", () => {
    expect(
      deliveryChanges(
        { set: set(PKG_A, [JUSPAY]), versions: V1 },
        { set: set(PKG_B, [JUSPAY]), versions: V2 },
      ),
    ).toBe("Claude Code 2.0.1 → 2.0.3");
  });

  it("a profile rebuilt, added and removed — the package unchanged names no harness", () => {
    expect(
      deliveryChanges(
        { set: set(PKG_A, [JUSPAY]), versions: V1 },
        { set: set(PKG_A, [JUSPAY_NEXT, EKALA]), versions: V1 },
      ),
    ).toBe("juspay a1b2c3d → d4e5f6a, ekala added 9f8e7d6c");
    expect(
      deliveryChanges(
        { set: set(PKG_A, [JUSPAY, EKALA]), versions: V1 },
        { set: set(PKG_A, [JUSPAY]), versions: V1 },
      ),
    ).toBe("ekala removed");
  });

  it("a path profile rebuilt is named by its store hashes", () => {
    const rebuilt = {
      ...EKALA,
      path: "/nix/store/0a1b2c3d4444444444444444444444-profile-ekala",
    };
    expect(
      deliveryChanges(
        { set: set(PKG_A, [EKALA]), versions: V1 },
        { set: set(PKG_A, [rebuilt]), versions: V1 },
      ),
    ).toBe("ekala 9f8e7d6c → 0a1b2c3d");
  });

  it("the same revision built anew is named by its store hashes, never `a1b2c3d → a1b2c3d`", () => {
    const rebuilt = {
      ...JUSPAY,
      path: "/nix/store/llllllll5555555555555555555555-profile-juspay",
    };
    expect(
      deliveryChanges(
        { set: set(PKG_A, [JUSPAY]), versions: V1 },
        { set: set(PKG_A, [rebuilt]), versions: V1 },
      ),
    ).toBe("juspay jjjjjjjj → llllllll");
  });

  it("a package and its profiles moving together are named in one line, harnesses first", () => {
    expect(
      deliveryChanges(
        { set: set(PKG_A, [JUSPAY]), versions: V1 },
        { set: set(PKG_B, [JUSPAY_NEXT]), versions: V2 },
      ),
    ).toBe("Claude Code 2.0.1 → 2.0.3, juspay a1b2c3d → d4e5f6a");
  });

  it("a new package that records no versions says so, in upstream's words", () => {
    expect(
      deliveryChanges(
        { set: set(PKG_A, []), versions: V1 },
        { set: set(PKG_B, []), versions: undefined },
      ),
    ).toBe("versions not recorded by this package");
  });
});
