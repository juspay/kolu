import { describe, expect, it } from "vitest";
import { formatGoDuration } from "./duration";

// Byte-parity with observed justci status descriptions (recon over merged
// PRs): 4s, 58s, 1m0s, 3m26s, 48m34s — Go time.Duration truncated to
// seconds, zero-padded units always present once a larger unit appears.
describe("formatGoDuration", () => {
  it("renders sub-minute durations as bare seconds", () => {
    expect(formatGoDuration(4_000)).toBe("4s");
    expect(formatGoDuration(58_900)).toBe("58s"); // truncation, not rounding
    expect(formatGoDuration(0)).toBe("0s");
  });

  it("keeps the zero-seconds form at exact minutes (1m0s, not 1m)", () => {
    expect(formatGoDuration(60_000)).toBe("1m0s");
    expect(formatGoDuration(206_000)).toBe("3m26s");
    expect(formatGoDuration(2_914_000)).toBe("48m34s");
  });

  it("extends Go-compatibly into hours (no live justci sample exists)", () => {
    expect(formatGoDuration(3_600_000)).toBe("1h0m0s");
    expect(formatGoDuration(3_723_000)).toBe("1h2m3s");
  });

  it("clamps negatives to 0s", () => {
    expect(formatGoDuration(-5_000)).toBe("0s");
  });
});
