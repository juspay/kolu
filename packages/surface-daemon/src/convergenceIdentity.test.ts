/**
 * Pin 2 — ordering is per-field law, and a consumer CANNOT spell a build-id comparison.
 * Contract versions are ORDERED (`contractIsNewer` / `contractIsCompatible`); build ids
 * are MATCH-ONLY (`buildIdMatches`), with NO ordering exported. This test pins both the
 * semantics and the API SHAPE — if a future edit adds a `buildIdIsNewer` / `buildIdCompare`,
 * the shape assertion fails loudly, because store hashes must never gain an order.
 */

import { describe, expect, it } from "vitest";
import * as identity from "./convergenceIdentity.ts";
import {
  buildsMatch,
  contractIsCompatible,
  contractIsNewer,
  daemonBuild,
} from "./convergenceIdentity.ts";

describe("contract version — ORDERED", () => {
  it("contractIsNewer: higher minor / higher major is newer; equal is not (numeric, not lexical)", () => {
    expect(contractIsNewer("1.1", "1.0")).toBe(true);
    expect(contractIsNewer("1.10", "1.2")).toBe(true);
    expect(contractIsNewer("2.0", "1.9")).toBe(true);
    expect(contractIsNewer("1.0", "1.1")).toBe(false);
    expect(contractIsNewer("1.9", "2.0")).toBe(false);
    expect(contractIsNewer("1.0", "1.0")).toBe(false);
  });

  it("contractIsNewer fails fast on an unparseable version (never silently mis-orders)", () => {
    expect(() => contractIsNewer("garbage", "1.0")).toThrow();
    expect(() => contractIsNewer("1", "1.0")).toThrow();
  });

  it("contractIsCompatible: same major, running minor ≥ mine", () => {
    expect(contractIsCompatible("1.0", "1.1")).toBe(true); // running 1.1 serves a 1.0 consumer
    expect(contractIsCompatible("1.1", "1.0")).toBe(false); // running 1.0 can't serve a 1.1 consumer
    expect(contractIsCompatible("1.0", "2.0")).toBe(false); // major skew
  });
});

describe("build — MATCH-ONLY, never ordered (Pin 2)", () => {
  it("buildsMatch: both known AND equal; an off-nix build is NEVER a match", () => {
    expect(buildsMatch(daemonBuild("B"), daemonBuild("B"))).toBe(true);
    expect(buildsMatch(daemonBuild("A"), daemonBuild("B"))).toBe(false);
    expect(buildsMatch(daemonBuild(""), daemonBuild("B"))).toBe(false); // absent running — not a match
    expect(buildsMatch(daemonBuild("B"), daemonBuild(""))).toBe(false); // off-nix supervisor — not a match
    expect(buildsMatch(daemonBuild(""), daemonBuild(""))).toBe(false); // two unknowns are not proven-the-same
  });

  it("the module exports NO build ordering — a consumer cannot spell one", () => {
    const exported = Object.keys(identity);
    // The build axis offers exactly one comparator: equality (`buildsMatch`). No
    // newer/older/compare — store hashes don't order.
    expect(exported).toContain("buildsMatch");
    for (const forbidden of [
      "buildIsNewer",
      "buildCompare",
      "buildOrder",
      "compareBuild",
      "buildIdMatches",
      "buildIdIsNewer",
      "buildIdCompare",
      "buildIdOrder",
      "compareBuildId",
    ]) {
      expect(exported).not.toContain(forbidden);
    }
  });
});
