import { describe, it, expect } from "vitest";
import { resolveTileUrl } from "./resolveTileUrl";

describe("resolveTileUrl", () => {
  it("passes https:// and http:// URLs through unchanged", () => {
    expect(resolveTileUrl("https://example.com")).toBe("https://example.com");
    expect(resolveTileUrl("http://localhost:3000/path?q=1")).toBe(
      "http://localhost:3000/path?q=1",
    );
  });

  it("prepends https:// when the URL has no scheme", () => {
    expect(resolveTileUrl("news.ycombinator.com")).toBe(
      "https://news.ycombinator.com",
    );
    expect(resolveTileUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("keeps non-http scheme URLs untouched", () => {
    expect(resolveTileUrl("about:blank")).toBe("about:blank");
    expect(resolveTileUrl("data:text/html,<h1>hi</h1>")).toBe(
      "data:text/html,<h1>hi</h1>",
    );
    expect(resolveTileUrl("file:///tmp/x.html")).toBe("file:///tmp/x.html");
  });

  it("trims whitespace before normalizing", () => {
    expect(resolveTileUrl("  example.com  ")).toBe("https://example.com");
    expect(resolveTileUrl(" https://x.dev ")).toBe("https://x.dev");
  });

  it("returns empty for empty input", () => {
    expect(resolveTileUrl("")).toBe("");
    expect(resolveTileUrl("   ")).toBe("");
  });
});
