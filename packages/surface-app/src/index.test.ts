/**
 * The freshness contract's pure kernels — the bits worth unit-testing in
 * isolation (no Hono, no Solid, no surface). These tests are the replacement
 * for the old per-consumer suites (server's `cacheControl.test.ts`, the
 * client's `commitRef.test.ts`, the deleted PWA test) that moved here when the
 * helpers were extracted into `@kolu/surface-app`. The whole point of the
 * extraction is to preserve these regression-prone paths once.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  clientIsStale,
  isCleanRef,
  isImmutableAssetPath,
  NOTIFICATION_SW_SOURCE,
  SHELL_CACHE_CONTROL,
  SW_SOURCE,
} from "./index";

describe("cacheControlFor", () => {
  it("pins content-hashed assets immutable", () => {
    expect(cacheControlFor("/assets/index-CDOaNpvy.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("/assets/index-BB54dgc_.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("makes the SPA shell no-store so a normal reload can't replay a stale shell", () => {
    expect(cacheControlFor("/")).toBe("no-store");
    expect(cacheControlFor("/index.html")).toBe("no-store");
  });

  it("revalidates /sw.js so the self-destructing worker is always re-fetched", () => {
    expect(cacheControlFor("/sw.js")).toBe("no-cache, must-revalidate");
  });

  it("has no opinion on anything else — including retired SW scripts", () => {
    expect(cacheControlFor("/registerSW.js")).toBeNull();
    expect(cacheControlFor("/workbox-01f28f5c.js")).toBeNull();
    expect(cacheControlFor("/favicon.svg")).toBeNull();
    expect(cacheControlFor("/manifest.webmanifest")).toBeNull();
    expect(cacheControlFor("/deep/client/route")).toBeNull();
  });

  it("honors a custom asset prefix + shell paths", () => {
    const paths = { assetPrefix: "/static/", shellPaths: ["/", "/app.html"] };
    expect(cacheControlFor("/static/x-hash.js", paths)).toBe(
      "public, max-age=31536000, immutable",
    );
    // The Vite default prefix is no longer special under an override.
    expect(cacheControlFor("/assets/x-hash.js", paths)).toBeNull();
    expect(cacheControlFor("/app.html", paths)).toBe("no-store");
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

  it("the asset-miss directive is itself no-store (a 404 must not be cached either)", () => {
    expect(ASSET_MISS_CACHE_CONTROL).toBe("no-store");
    expect(SHELL_CACHE_CONTROL).toBe("no-store");
  });
});

describe("isCleanRef", () => {
  it.each([
    { sha: "0784979", expected: true, why: "a real short SHA" },
    { sha: undefined, expected: false, why: "absent" },
    { sha: "", expected: false, why: "empty" },
    { sha: "dev", expected: false, why: "the dev sentinel" },
    { sha: "0784979-dirty", expected: false, why: "a dirty working tree" },
  ])("$why → $expected", ({ sha, expected }) => {
    expect(isCleanRef(sha)).toBe(expected);
  });
});

describe("clientIsStale", () => {
  it.each([
    {
      server: "0784979",
      client: "abc1234",
      expected: true,
      why: "two clean refs that disagree → stale (cached old bundle)",
    },
    {
      server: "0784979",
      client: "0784979",
      expected: false,
      why: "identical clean refs → up to date",
    },
    {
      server: "dev",
      client: "abc1234",
      expected: false,
      why: "dev server can't prove staleness",
    },
    {
      server: "0784979",
      client: "dev",
      expected: false,
      why: "dev client can't be called stale",
    },
    {
      server: "0784979-dirty",
      client: "abc1234",
      expected: false,
      why: "dirty server is not a trustworthy baseline",
    },
    {
      server: "0784979",
      client: "abc1234-dirty",
      expected: false,
      why: "dirty client is a local build, not a cache miss",
    },
    {
      server: undefined,
      client: "abc1234",
      expected: false,
      why: "no server info yet (link still connecting)",
    },
  ])("$why", ({ server, client, expected }) => {
    expect(clientIsStale(server, client)).toBe(expected);
  });
});

describe("SW_SOURCE (the self-destructing retirement worker)", () => {
  it("skips waiting, unregisters itself, deletes caches, and reloads tabs", () => {
    expect(SW_SOURCE).toContain("self.skipWaiting()");
    expect(SW_SOURCE).toContain("self.registration.unregister()");
    expect(SW_SOURCE).toContain("caches.delete");
    expect(SW_SOURCE).toContain("client.navigate(client.url)");
  });
});

describe("NOTIFICATION_SW_SOURCE (the fetch-less notification worker)", () => {
  it("registers NO fetch handler — the property that keeps it freshness-safe", () => {
    // A fetch handler is the only way a worker can serve a stale shell; without
    // one it does zero caching, so it can't violate the freshness contract.
    expect(NOTIFICATION_SW_SOURCE).not.toContain('"fetch"');
    expect(NOTIFICATION_SW_SOURCE).not.toContain("onfetch");
  });

  it("handles notificationclick and routes the click back to a window", () => {
    expect(NOTIFICATION_SW_SOURCE).toContain('"notificationclick"');
    expect(NOTIFICATION_SW_SOURCE).toContain("client.focus()");
    expect(NOTIFICATION_SW_SOURCE).toContain("client.postMessage");
    expect(NOTIFICATION_SW_SOURCE).toContain("openWindow");
  });

  it("heals a legacy caching worker on activate (purge caches + claim), without self-unregistering", () => {
    expect(NOTIFICATION_SW_SOURCE).toContain("self.skipWaiting()");
    expect(NOTIFICATION_SW_SOURCE).toContain("caches.delete");
    expect(NOTIFICATION_SW_SOURCE).toContain("self.clients.claim()");
    // It must persist (it's the live notification host) — unlike SW_SOURCE.
    expect(NOTIFICATION_SW_SOURCE).not.toContain(
      "self.registration.unregister()",
    );
  });
});
