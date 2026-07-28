/**
 * `shuffleMode` (in `./surface.ts`) — the single source resolving which luminance
 * family a theme shuffle draws from, given the `shuffleBehavior` preference and
 * the app's resolved dark mode. (The terminal-vocabulary tests —
 * `composeTerminalMetadata` and friends — moved to `@kolu/padi`'s `vocab.test.ts`
 * with the schemas they exercise.)
 */

import { padiSurface } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import {
  DaemonInventorySchema,
  type KoluForward,
  KoluForwardSchema,
  PadiConvergenceSchema,
  sameForwards,
  shuffleMode,
  surfaces,
} from "./surface.ts";
import { surfacesWithPadi } from "./surfacesWithPadi.ts";

describe("surfacesWithPadi — the app composes its registry FROM padi", () => {
  it("adds exactly the `padi` sibling to the padi-less `surfaces` map", () => {
    // The padi-less `surfaces` (what `kolu-common/contract` + the client consume)
    // is unchanged; the composed map kolu-server serves adds exactly `padi`,
    // pulling `padiSurface` from @kolu/padi — the post-flip arrow (app→padi).
    expect(Object.keys(surfaces)).not.toContain("padi");
    expect(Object.keys(surfacesWithPadi)).toEqual([
      ...Object.keys(surfaces),
      "padi",
    ]);
    expect(surfacesWithPadi.padi).toBe(padiSurface);
  });
});

describe("shuffleMode", () => {
  it("random imposes no family restriction", () => {
    expect(shuffleMode("random", true)).toBeUndefined();
    expect(shuffleMode("random", false)).toBeUndefined();
  });

  it("dark / light force their family regardless of app mode", () => {
    expect(shuffleMode("dark", false)).toBe("dark");
    expect(shuffleMode("light", true)).toBe("light");
  });

  it("auto tracks the app's resolved dark mode", () => {
    expect(shuffleMode("auto", true)).toBe("dark");
    expect(shuffleMode("auto", false)).toBe("light");
  });
});

describe("PadiConvergenceSchema — framework-shaped arms, no z.null() padding", () => {
  const identity = (contractVersion: string, buildId: string) => ({
    contractVersion,
    build: { kind: "known" as const, id: buildId },
  });

  it("accepts adopted-stale with running + expected identities", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "adopted-stale",
        running: identity("1.0", "abc"),
        expected: identity("1.0", "def"),
        detail: "mismatch",
      }).success,
    ).toBe(true);
  });

  it("accepts skew-refused with typed identities (no null padding)", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "skew-refused",
        running: identity("99.0", "x"),
        expected: identity("1.0", "y"),
        detail: "refusing",
      }).success,
    ).toBe(true);
  });

  it("accepts cross-supervisor with drained + observed instance keys as data", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "cross-supervisor",
        drained: { kind: "instance", key: 1 },
        observed: { kind: "instance", key: 2 },
        running: identity("1.0", "old"),
        detail: "fight",
      }).success,
    ).toBe(true);
  });

  it("accepts unconverged and link-failed without padding fields", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "unconverged",
        running: identity("1.0", "x"),
        detail: "budget",
      }).success,
    ).toBe(true);
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "link-failed",
        detail: "ssh died",
      }).success,
    ).toBe(true);
  });

  it("rejects old wire shape (state + null padding)", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        state: "link-failed",
        runningBuild: null,
        expectedBuild: null,
        detail: "reason",
      }).success,
    ).toBe(false);
    expect(
      PadiConvergenceSchema.safeParse({
        kind: "adopted-stale",
        runningBuild: "abc",
        expectedBuild: "def",
        detail: "mismatch",
      }).success,
    ).toBe(false);
  });
});

describe("DaemonInventorySchema.boundPadi — exactly one representation of 'nothing to report'", () => {
  const binding = { kind: "local" as const };

  it("accepts the top-level null, and an inner object with at least one non-null field", () => {
    expect(
      DaemonInventorySchema.safeParse({ binding, boundPadi: null }).success,
    ).toBe(true);
    expect(
      DaemonInventorySchema.safeParse({
        binding,
        boundPadi: {
          surfaceVersion: "1.2",
          buildCommit: null,
          convergence: null,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects the redundant inner all-null shape — that meaning is spelled only as top-level null", () => {
    expect(
      DaemonInventorySchema.safeParse({
        binding,
        boundPadi: {
          surfaceVersion: null,
          buildCommit: null,
          convergence: null,
        },
      }).success,
    ).toBe(false);
  });
});

describe("sameForwards — the forwards cell's dedup gate", () => {
  const ROW: KoluForward = {
    key: "remote:pu-dev:5173",
    host: { kind: "remote", target: "pu-dev" },
    remotePort: 5173,
    localPort: 61003,
    origin: "auto",
    createdAt: 1_700_000_000_000,
  };

  /** A value of the right shape that DIFFERS from the row's, per field. */
  const OTHER: KoluForward = {
    key: "remote:pu-dev:5174",
    host: { kind: "local" },
    remotePort: 5174,
    localPort: 61004,
    origin: "manual",
    createdAt: 1_700_000_000_001,
  };

  it("sees a change in every field `key` does not already determine", () => {
    // Read off the schema rather than hand-listed, so this test grows with
    // `KoluForwardSchema` — a field the gate stops comparing is a field whose
    // changes are swallowed with nothing anywhere to report why the row froze.
    //
    // `host` and `remotePort` are excluded on both sides, and the exclusion is
    // the point rather than a concession: `key` IS `targetKey`, which encodes
    // `local:<port>` / `remote:<host>:<port>`, so two rows agreeing on `key`
    // cannot disagree on either. Comparing them bought nothing and cost the
    // guarantee — `host` is object-valued, so it needed a hand-coded arm, and
    // the NEXT object-valued field would have fallen through to `===`, compared
    // by reference across freshly minted rows, never matched, and silently
    // stopped the dedup. The case below pins the transitive half.
    const determinedByKey = new Set(["host", "remotePort"]);
    for (const key of Object.keys(
      KoluForwardSchema.shape,
    ) as (keyof KoluForward)[]) {
      if (determinedByKey.has(key)) continue;
      expect(
        sameForwards([ROW], [{ ...ROW, [key]: OTHER[key] } as KoluForward]),
        `sameForwards ignores "${key}"`,
      ).toBe(false);
    }
  });

  it("catches a moved host or remote port THROUGH the key that encodes them", () => {
    // The excluded fields are not unwatched — they are watched by proxy. A row
    // whose host or remote port genuinely moved is a row with a different
    // `targetKey`, so the change arrives on `key` and the gate sees it.
    expect(
      sameForwards(
        [ROW],
        [{ ...ROW, key: "remote:zest:5173", host: { kind: "local" } }],
      ),
    ).toBe(false);
    expect(
      sameForwards(
        [ROW],
        [{ ...ROW, key: "remote:pu-dev:9999", remotePort: 9999 }],
      ),
    ).toBe(false);
  });

  it("says nothing changed when nothing did, host object identity included", () => {
    expect(
      sameForwards(
        [ROW],
        [{ ...ROW, host: { kind: "remote", target: "pu-dev" } }],
      ),
    ).toBe(true);
    expect(sameForwards([ROW], [ROW, ROW])).toBe(false);
  });
});
