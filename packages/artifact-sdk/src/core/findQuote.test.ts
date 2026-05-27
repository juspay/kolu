import { describe, expect, it } from "vitest";
import { findQuote } from "./findQuote";

describe("findQuote", () => {
  it("returns null when the quote is not present", () => {
    expect(
      findQuote("hello world", { quote: "missing", prefix: "", suffix: "" }),
    ).toBeNull();
  });

  it("matches a unique occurrence regardless of prefix/suffix", () => {
    const out = findQuote("the quick brown fox", {
      quote: "quick",
      prefix: "",
      suffix: "",
    });
    expect(out).toEqual({ start: 4, end: 9 });
  });

  it("uses prefix to disambiguate duplicate quotes", () => {
    const text = "first foo here, second foo there";
    const out = findQuote(text, {
      quote: "foo",
      prefix: "second ",
      suffix: " there",
    });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(text.slice(out.start, out.end)).toBe("foo");
    expect(out.start).toBe(text.indexOf("second foo") + "second ".length);
  });

  it("uses suffix when prefix alone is ambiguous", () => {
    const text = "x foo a y foo b";
    const out = findQuote(text, {
      quote: "foo",
      prefix: "",
      suffix: " b",
    });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.start).toBe(text.indexOf("foo b"));
  });

  it("falls back to first occurrence when both prefix and suffix mismatch", () => {
    const text = "alpha bar beta bar gamma";
    const out = findQuote(text, {
      quote: "bar",
      prefix: "totally different",
      suffix: "completely off",
    });
    expect(out).not.toBeNull();
    if (!out) return;
    // Neither context matches; both occurrences score 0 — take the first.
    expect(out.start).toBe(text.indexOf("bar"));
  });
});
