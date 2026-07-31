/**
 * Pins the realm-safe brand guard for {@link SocketProbeIndeterminateError}
 * (R5-2 gatePid attestation; R6-1 total over `unknown` — never throws).
 */

import { describe, expect, it } from "vitest";
import {
  isSocketProbeIndeterminateError,
  SocketProbeIndeterminateError,
} from "./index.ts";

describe("isSocketProbeIndeterminateError", () => {
  it("is total over non-object inputs — returns false, never throws (R6-1)", () => {
    // Primitive table: every non-object `unknown` must classify as false without
    // throwing (a catch classifier must not replace the original error).
    const primitives: unknown[] = [null, undefined, 0, 1, "x", true, false];
    for (const input of primitives) {
      expect(isSocketProbeIndeterminateError(input)).toBe(false);
    }
  });

  it("accepts a real instance with numeric gatePid", () => {
    const err = new SocketProbeIndeterminateError(
      { gatePath: "/g", socketPath: "/s" },
      42,
    );
    expect(isSocketProbeIndeterminateError(err)).toBe(true);
    if (isSocketProbeIndeterminateError(err)) {
      expect(err.gatePid).toBe(42);
    }
  });

  it("accepts a real instance with absent gatePid", () => {
    const err = new SocketProbeIndeterminateError({
      gatePath: "/g",
      socketPath: "/s",
    });
    expect(isSocketProbeIndeterminateError(err)).toBe(true);
    if (isSocketProbeIndeterminateError(err)) {
      expect(err.gatePid).toBeUndefined();
    }
  });

  it('rejects a branded carrier with gatePid: "not-a-pid"', () => {
    expect(
      isSocketProbeIndeterminateError({
        isSocketProbeIndeterminate: true,
        gatePath: "/g",
        socketPath: "/s",
        gatePid: "not-a-pid",
      }),
    ).toBe(false);
  });

  it("rejects a branded carrier with non-positive gatePid", () => {
    expect(
      isSocketProbeIndeterminateError({
        isSocketProbeIndeterminate: true,
        gatePath: "/g",
        socketPath: "/s",
        gatePid: 0,
      }),
    ).toBe(false);
  });
});
