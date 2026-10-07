import { BYTES_PER_MB as MB } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { bytesToMB, formatMB, formatMBCompact } from "./memory";

describe("bytesToMB", () => {
  it("rounds to 0.1 MB", () => {
    expect(bytesToMB(MB)).toBe(1);
    expect(bytesToMB(1.5 * MB)).toBe(1.5);
    expect(bytesToMB(1.04 * MB)).toBe(1);
  });
});

describe("formatMB", () => {
  it("drops to KiB below ~100 KiB so a tiny buffer doesn't read as 0.0 MiB", () => {
    expect(formatMB(23_000)).toBe("22 KiB");
    expect(formatMB(50_000)).toBe("49 KiB");
  });

  it("renders MB with one decimal at or above 100 KB", () => {
    expect(formatMB(150 * MB)).toBe("150.0 MiB");
    expect(formatMB(1.5 * MB)).toBe("1.5 MiB");
  });
});

describe("formatMBCompact", () => {
  it("renders whole MB for the rail's glanceable readout", () => {
    expect(formatMBCompact(142 * MB)).toBe("142 MiB");
    expect(formatMBCompact(0)).toBe("0 MiB");
  });

  it("rounds to the nearest whole MB", () => {
    expect(formatMBCompact(141.4 * MB)).toBe("141 MiB");
    expect(formatMBCompact(141.6 * MB)).toBe("142 MiB");
  });
});
