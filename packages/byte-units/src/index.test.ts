import { describe, expect, it } from "vitest";
import { formatBytes, formatMiB, GIB, KIB, MIB, mibOf } from "./index.ts";

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

  it("picks the unit on the rounded figure: never 1024 of a unit", () => {
    expect(formatBytes(1023.6)).toBe("1 KiB");
    expect(formatBytes(1023.6 * KIB)).toBe("1 MiB");
    expect(formatBytes(1023.6 * MIB)).toBe("1.0 GiB");
    expect(formatBytes(1023)).toBe("1023 B");
  });
});

describe("mibOf — the one MiB rounding", () => {
  it("whole or a tenth, the figure formatMiB writes", () => {
    expect(mibOf(1.04 * MIB, 1)).toBe(1);
    expect(mibOf(1.5 * MIB, 1)).toBe(1.5);
    expect(mibOf(141.4 * MIB, 0)).toBe(141);
    expect(formatMiB(141.4 * MIB, 0)).toBe(`${mibOf(141.4 * MIB, 0)} MiB`);
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
