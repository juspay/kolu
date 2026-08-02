/**
 * The framework-reserved clock probe (`./clockNow`): every surface built by
 * `defineSurface` carries `surface/system/clockNow`, auto-answered by
 * `implementSurface` with the server's own wall clock, so a consumer can measure
 * the far-end clock offset at admit with zero app wiring. These pins:
 *   1. every surface mints the reserved `system/clockNow` tag, with the frozen
 *      `{ epochMs }` wire shape;
 *   2. it MERGES into an app-owned `system` namespace (beside `live`/`identity`)
 *      rather than colliding with it;
 *   3. an app that tries to claim `system.clockNow` itself gets a loud boot-time
 *      collision (reserved verbs can't be silently clobbered);
 *   4. `probeSurfaceClockNow` resolves against a client face carrying the member,
 *      and raises a TYPED absence error against one that doesn't;
 *   5. `measureSurfaceClockOffset` returns the RTT-compensated far-end offset.
 *
 * Pins 4 and 5 drive the probe against a hand-built client face rather than a
 * served surface: the probe is a walk over the typed nested face, and the face's
 * transport is irrelevant to what it pins. The served round-trip (the same probe
 * against a real `implementSurface`) belongs with the server, and lands with it.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ClockNowUnavailableError,
  measureSurfaceClockOffset,
  probeSurfaceClockNow,
  ServedClockNowSchema,
} from "./clockNow";
import { defineSurface } from "./define";

/** A minimal stand-in for the typed nested client face the Stage-3 client
 *  builds: `client.surface.<namespace>.<verb>(input, opts)`. */
function faceAnswering(epochMs: () => number) {
  return {
    surface: {
      system: {
        clockNow: async () => ({ epochMs: epochMs() }),
      },
    },
  };
}

// A surface that ALSO declares its own `system.*` verb, to prove the reserved
// `system/clockNow` merges into an app-owned `system` namespace rather than
// displacing it.
function buildSurface() {
  return defineSurface({
    cells: {
      state: {
        schema: Schema.Struct({ value: Schema.Number }),
        default: { value: 0 },
      },
    },
    procedures: {
      system: {
        echo: {
          input: Schema.Struct({ n: Schema.Number }),
          output: Schema.Struct({ n: Schema.Number }),
        },
      },
    },
  });
}

describe("framework-reserved system/clockNow member", () => {
  it("every surface mints the reserved clock tag", () => {
    expect(buildSurface().group.requests.has("surface/system/clockNow")).toBe(
      true,
    );
    expect(
      defineSurface({}).group.requests.has("surface/system/clockNow"),
    ).toBe(true);
  });

  it("coexists with an app's own system.* verb (merge, not collision)", () => {
    const tags = [...buildSurface().group.requests.keys()];
    expect(tags).toContain("surface/system/echo");
    expect(tags).toContain("surface/system/clockNow");
    expect(tags).toContain("surface/system/live");
    expect(tags).toContain("surface/system/identity");
  });

  it("rejects an app that tries to claim the reserved `system.clockNow` verb", () => {
    expect(() =>
      defineSurface({
        procedures: {
          system: {
            clockNow: {
              input: Schema.Struct({}),
              output: Schema.Struct({}),
            },
          },
        },
      }),
    ).toThrow(/duplicate verb "clockNow"/);
  });

  it("serves the frozen `{ epochMs }` wire shape", () => {
    const encode = Schema.encodeUnknownSync(ServedClockNowSchema);
    expect(JSON.stringify(encode({ epochMs: 1730000000000 }))).toBe(
      '{"epochMs":1730000000000}',
    );
    expect(
      Schema.decodeUnknownSync(ServedClockNowSchema)({ epochMs: 12 }),
    ).toEqual({ epochMs: 12 });
    expect(() =>
      Schema.decodeUnknownSync(ServedClockNowSchema)({ epochMs: "12" }),
    ).toThrow();
  });
});

describe("probeSurfaceClockNow", () => {
  it("resolves against a client face carrying the reserved member", async () => {
    await expect(
      probeSurfaceClockNow(faceAnswering(() => 1234)),
    ).resolves.toEqual({ epochMs: 1234 });
  });

  it("throws a TYPED absence error rather than a TypeError, per missing step", () => {
    // The whole point of the typed error: a caller classifies "member absent" by
    // an `instanceof` check, never by string-matching a `TypeError` message,
    // which differs by WHICH navigation step is undefined and by JS engine.
    expect(() => probeSurfaceClockNow({})).toThrow(ClockNowUnavailableError);
    expect(() => probeSurfaceClockNow({})).toThrow(
      /no `surface` on the client/,
    );
    expect(() => probeSurfaceClockNow({ surface: {} })).toThrow(
      /no reserved `system` namespace/,
    );
    expect(() => probeSurfaceClockNow({ surface: { system: {} } })).toThrow(
      /no `system.clockNow` verb/,
    );
  });
});

describe("measureSurfaceClockOffset", () => {
  it("yields ~0 against a face on THIS process's wall clock (RTT-compensated)", async () => {
    // The face answers with this process's own `Date.now()`, so the measured
    // offset must be ~0 — the RTT-midpoint sampling keeps it from being biased by
    // the round-trip latency.
    const offset = await measureSurfaceClockOffset(faceAnswering(Date.now));
    expect(Math.abs(offset)).toBeLessThan(100);
  });

  it("reports a far-end clock that is ahead as a positive offset", async () => {
    const skewMs = 3_600_000;
    const offset = await measureSurfaceClockOffset(
      faceAnswering(() => Date.now() + skewMs),
    );
    expect(Math.abs(offset - skewMs)).toBeLessThan(100);
  });
});
