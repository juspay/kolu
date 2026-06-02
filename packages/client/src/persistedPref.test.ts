import { describe, expect, it, vi } from "vitest";
import { readWithFallback } from "./persistedPref";

/** `readWithFallback` is the validation/fallback core every `persistedPref`
 *  call site runs on read. These tests pin the two latent bugs the migration
 *  closes — a `NaN` font size and a `"false"`-reads-truthy maximized flag —
 *  plus the generic corrupt-entry-degrades-to-default contract. */
describe("readWithFallback", () => {
  it("returns the parsed value when parse succeeds", () => {
    expect(readWithFallback("rail", (r) => r, "cards")).toBe("rail");
  });

  it("substitutes the fallback and reports when parse throws", () => {
    const onInvalid = vi.fn();
    const result = readWithFallback(
      "{bad json",
      (raw) => JSON.parse(raw) as unknown,
      { v: 1 },
      onInvalid,
    );
    expect(result).toEqual({ v: 1 });
    expect(onInvalid).toHaveBeenCalledOnce();
    expect(onInvalid.mock.calls[0]?.[1]).toBe("{bad json");
  });

  it("rejects a non-finite number — the font-size NaN guard", () => {
    const parseFontSize = (raw: string): number => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0)
        throw new Error(`invalid font size: ${raw}`);
      return n;
    };
    expect(readWithFallback("NaN", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("garbage", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("0", parseFontSize, 14)).toBe(14);
    expect(readWithFallback("18", parseFontSize, 14)).toBe(18);
  });

  it("reads a stored boolean strictly — the maximized 'false'-is-true guard", () => {
    const parseBool = (raw: string): boolean => raw === "true";
    expect(readWithFallback("false", parseBool, false)).toBe(false);
    expect(readWithFallback("true", parseBool, false)).toBe(true);
    // Anything that isn't exactly "true" is false — no truthy-string leak.
    expect(readWithFallback("1", parseBool, false)).toBe(false);
  });

  it("does not call onInvalid on the happy path", () => {
    const onInvalid = vi.fn();
    readWithFallback("24h", (r) => r, "24h", onInvalid);
    expect(onInvalid).not.toHaveBeenCalled();
  });
});
