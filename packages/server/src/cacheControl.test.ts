import { describe, expect, it } from "vitest";
import { getCacheControlHeader, isImmutableAssetPath } from "./cacheControl.ts";

describe("getCacheControlHeader", () => {
  it("pins content-hashed assets immutable", () => {
    expect(getCacheControlHeader("/assets/index-CDOaNpvy.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(getCacheControlHeader("/assets/index-BB54dgc_.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("makes the SPA shell no-store so a normal reload can't replay a stale shell", () => {
    expect(getCacheControlHeader("/")).toBe("no-store");
    expect(getCacheControlHeader("/index.html")).toBe("no-store");
  });

  it("revalidates the service-worker scripts on every request", () => {
    for (const p of ["/sw.js", "/registerSW.js", "/workbox-01f28f5c.js"]) {
      expect(getCacheControlHeader(p)).toBe("no-cache, must-revalidate");
    }
  });

  it("has no opinion on anything else", () => {
    expect(getCacheControlHeader("/favicon.svg")).toBeNull();
    expect(getCacheControlHeader("/manifest.webmanifest")).toBeNull();
    expect(getCacheControlHeader("/deep/client/route")).toBeNull();
  });
});

describe("isImmutableAssetPath", () => {
  it("matches the content-hashed asset dir (a miss there must 404, not the shell)", () => {
    expect(isImmutableAssetPath("/assets/index-CDOaNpvy.js")).toBe(true);
    expect(isImmutableAssetPath("/assets/anything")).toBe(true);
  });

  it("rejects every non-asset path (those still fall through to the SPA shell)", () => {
    for (const p of [
      "/",
      "/index.html",
      "/sw.js",
      "/favicon.svg",
      "/foo.js",
      "/sounds/x.mp3",
      "/assetsX/y.js",
      "/deep/route",
    ]) {
      expect(isImmutableAssetPath(p)).toBe(false);
    }
  });
});
