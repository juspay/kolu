import { describe, expect, it } from "vitest";
import { formatBytes, formatMiB, GIB, KIB, MIB } from "./index.ts";

describe("formatBytes — binary units, picked by size", () => {
  it("B, whole KiB, whole MiB, one decimal of GiB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(23_000)).toBe("22 KiB");
    expect(formatBytes(640 * MIB)).toBe("640 MiB");
    expect(formatBytes(1.1 * GIB)).toBe("1.1 GiB");
  });

  it("is binary: 1024 KiB is 1 MiB, not 1000", () => {
    expect(formatBytes(1024 * KIB)).toBe("1 MiB");
    expect(formatBytes(1_000_000)).toBe("977 KiB");
  });
});

describe("formatMiB — a fixed-unit readout", () => {
  it("one decimal or whole", () => {
    expect(formatMiB(150 * MIB, 1)).toBe("150.0 MiB");
    expect(formatMiB(1.5 * MIB, 1)).toBe("1.5 MiB");
    expect(formatMiB(141.6 * MIB, 0)).toBe("142 MiB");
    expect(formatMiB(0, 0)).toBe("0 MiB");
  });
});
