import { MIB } from "@kolu/byte-units";
import { describe, expect, it } from "vitest";
import { formatSize, mibText } from "./memory";

describe("formatSize", () => {
  it("drops to KiB below ~100 KiB", () => {
    expect(formatSize(23_000)).toBe("22 KiB");
    expect(formatSize(50_000)).toBe("49 KiB");
  });

  it("uses one decimal of MiB above", () => {
    expect(formatSize(150 * MIB)).toBe("150.0 MiB");
    expect(formatSize(1.5 * MIB)).toBe("1.5 MiB");
  });
});

describe("mibText", () => {
  it("is a whole-MiB figure", () => {
    expect(mibText(142 * MIB)).toBe("142 MiB");
    expect(mibText(0)).toBe("0 MiB");
    expect(mibText(141.4 * MIB)).toBe("141 MiB");
    expect(mibText(141.6 * MIB)).toBe("142 MiB");
  });

  it("says when there is no figure", () => {
    expect(mibText(null)).toBe("unavailable");
    expect(mibText(null, "—")).toBe("—");
  });
});
