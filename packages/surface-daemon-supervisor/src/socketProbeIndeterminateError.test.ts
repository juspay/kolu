/**
 * Pins the realm-safe brand guard for {@link SocketProbeIndeterminateError} (R5-2).
 */

import { describe, expect, it } from "vitest";
import {
  isSocketProbeIndeterminateError,
  SocketProbeIndeterminateError,
} from "./index.ts";

describe("isSocketProbeIndeterminateError (R5-2)", () => {
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
