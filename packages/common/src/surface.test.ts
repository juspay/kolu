/**
 * `shuffleMode` (in `./surface.ts`) — the single source resolving the candidate
 * pool filter a theme shuffle applies (`light` / `dark` / `colourful` / unrestricted),
 * given the `shuffleBehavior` preference and the app's resolved dark mode — plus
 * the two folds built on it: `resolveIsDark` (the one reading of "system") and
 * `resolveNewTerminalPolicy` (the one derivation kolu-server pushes into padi).
 * (The terminal-vocabulary tests — `composeTerminalMetadata` and friends — moved
 * to `@kolu/padi`'s `vocab.test.ts` with the schemas they exercise.)
 */

import { DEFAULT_NEW_TERMINAL_POLICY, padiSurface } from "@kolu/padi/surface";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  DaemonInventorySchema,
  DEFAULT_PREFERENCES,
  type KoluForward,
  KoluForwardSchema,
  PadiConvergenceSchema,
  type Preferences,
  resolveIsDark,
  resolveNewTerminalPolicy,
  sameForwards,
  shuffleMode,
  surfaces,
} from "./surface.ts";
import { surfacesWithPadi } from "./surfacesWithPadi.ts";

/** zod's `.safeParse(x).success`, in Effect terms. */
const accepts =
  <T, E>(schema: Schema.Codec<T, E>) =>
  (value: unknown): boolean =>
    Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

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

  it("colourful is independent of app light/dark", () => {
    expect(shuffleMode("colourful", true)).toBe("colourful");
    expect(shuffleMode("colourful", false)).toBe("colourful");
  });
});

describe("resolveIsDark — the one reading of what 'system' means", () => {
  it("takes an explicit scheme at its word and ignores the viewer's OS", () => {
    expect(resolveIsDark("dark", false)).toBe(true);
    expect(resolveIsDark("light", true)).toBe(false);
  });

  it("defers to the viewer's OS only under `system`", () => {
    expect(resolveIsDark("system", true)).toBe(true);
    expect(resolveIsDark("system", false)).toBe(false);
  });
});

describe("resolveNewTerminalPolicy — the one derivation pushed into padi", () => {
  const prefs = (patch: Partial<Preferences>) => ({
    ...DEFAULT_PREFERENCES,
    ...patch,
  });

  it("matches padi's baked default on a default install", () => {
    // padi resolves against `DEFAULT_NEW_TERMINAL_POLICY` in the window between
    // its boot and the binder's first push. That window behaves like a default
    // install only while these two agree — and padi cannot assert it (the seal
    // keeps `DEFAULT_PREFERENCES` out of that package), so the pin lives here.
    expect(resolveNewTerminalPolicy(DEFAULT_PREFERENCES, "dark")).toEqual(
      DEFAULT_NEW_TERMINAL_POLICY,
    );
    // The default `colorScheme: "dark"` settles it, so the viewer's OS reading
    // cannot move the boot window off padi's baked value either.
    expect(resolveNewTerminalPolicy(DEFAULT_PREFERENCES, "light")).toEqual(
      DEFAULT_NEW_TERMINAL_POLICY,
    );
  });

  it("carries `inherit` through untouched — shuffle's inputs are irrelevant to it", () => {
    expect(
      resolveNewTerminalPolicy(
        prefs({ newTerminalTheme: "inherit", shuffleBehavior: "colourful" }),
        "light",
      ),
    ).toEqual({ kind: "inherit" });
  });

  it("spells `shuffleMode`'s unrestricted answer as the explicit `random` literal", () => {
    // The wire union has no "absent" — `undefined` would fail the schema.
    expect(
      resolveNewTerminalPolicy(
        prefs({ newTerminalTheme: "shuffle", shuffleBehavior: "random" }),
        "dark",
      ),
    ).toEqual({ kind: "shuffle", mode: "random" });
  });

  it("passes a fixed family straight through", () => {
    for (const behavior of ["dark", "light", "colourful"] as const) {
      expect(
        resolveNewTerminalPolicy(
          prefs({ newTerminalTheme: "shuffle", shuffleBehavior: behavior }),
          "light",
        ),
      ).toEqual({ kind: "shuffle", mode: behavior });
    }
  });

  it("spends `auto` here — it never crosses the wire", () => {
    const auto = (
      colorScheme: Preferences["colorScheme"],
      viewer: "dark" | "light",
    ) =>
      resolveNewTerminalPolicy(
        prefs({
          newTerminalTheme: "shuffle",
          shuffleBehavior: "auto",
          colorScheme,
        }),
        viewer,
      );
    // Under `system` the viewer's OS decides…
    expect(auto("system", "dark")).toEqual({ kind: "shuffle", mode: "dark" });
    expect(auto("system", "light")).toEqual({ kind: "shuffle", mode: "light" });
    // …and an explicit scheme overrides it, in both directions.
    expect(auto("dark", "light")).toEqual({ kind: "shuffle", mode: "dark" });
    expect(auto("light", "dark")).toEqual({ kind: "shuffle", mode: "light" });
  });
});

describe("PadiConvergenceSchema — framework-shaped arms, no null padding", () => {
  const identity = (contractVersion: string, buildId: string) => ({
    contractVersion,
    build: { kind: "known" as const, id: buildId },
  });

  it("accepts adopted-stale with running + expected identities", () => {
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "adopted-stale",
        running: identity("1.0", "abc"),
        expected: identity("1.0", "def"),
        detail: "mismatch",
      }),
    ).toBe(true);
  });

  it("accepts skew-refused with typed identities (no null padding)", () => {
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "skew-refused",
        running: identity("99.0", "x"),
        expected: identity("1.0", "y"),
        detail: "refusing",
      }),
    ).toBe(true);
  });

  it("accepts cross-supervisor with drained + observed instance keys as data", () => {
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "cross-supervisor",
        drained: { kind: "instance", key: 1 },
        observed: { kind: "instance", key: 2 },
        running: identity("1.0", "old"),
        detail: "fight",
      }),
    ).toBe(true);
  });

  it("accepts unconverged and link-failed without padding fields", () => {
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "unconverged",
        running: identity("1.0", "x"),
        expected: identity("1.0", "y"),
        cause: {
          kind: "budget-exhausted",
          axis: "build",
          attempts: 3,
          maxAttempts: 3,
        },
        detail: "budget",
      }),
    ).toBe(true);
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "link-failed",
        detail: "ssh died",
      }),
    ).toBe(true);
  });

  it("rejects old wire shape (state + null padding)", () => {
    expect(
      accepts(PadiConvergenceSchema)({
        state: "link-failed",
        runningBuild: null,
        expectedBuild: null,
        detail: "reason",
      }),
    ).toBe(false);
    expect(
      accepts(PadiConvergenceSchema)({
        kind: "adopted-stale",
        runningBuild: "abc",
        expectedBuild: "def",
        detail: "mismatch",
      }),
    ).toBe(false);
  });
});

describe("DaemonInventorySchema.boundPadi — exactly one representation of 'nothing to report'", () => {
  const binding = { kind: "local" as const };

  it("accepts the top-level null, and an inner object with at least one non-null field", () => {
    expect(accepts(DaemonInventorySchema)({ binding, boundPadi: null })).toBe(
      true,
    );
    expect(
      accepts(DaemonInventorySchema)({
        binding,
        boundPadi: {
          surfaceVersion: "1.2",
          buildCommit: null,
          convergence: null,
        },
      }),
    ).toBe(true);
  });

  it("rejects the redundant inner all-null shape — that meaning is spelled only as top-level null", () => {
    const allNull = {
      binding,
      boundPadi: {
        surfaceVersion: null,
        buildCommit: null,
        convergence: null,
      },
    };
    expect(accepts(DaemonInventorySchema)(allNull)).toBe(false);
    // The MESSAGE is the half a boolean assertion cannot see — it is what a
    // publisher hitting this reads, so it survives the schema-library change
    // verbatim.
    const result = Schema.decodeUnknownResult(DaemonInventorySchema)(allNull);
    expect(Result.isFailure(result) ? String(result.failure) : "").toContain(
      "boundPadi: nothing to report is the top-level null, not an inner object with every field null",
    );
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
      KoluForwardSchema.fields,
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
