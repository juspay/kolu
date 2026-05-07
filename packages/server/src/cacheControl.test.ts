import { describe, expect, it } from "vitest";
import {
  getCacheControlHeader,
  REVALIDATE_CACHE_CONTROL,
} from "./cacheControl";

describe("getCacheControlHeader", () => {
  it("pins Vite content-addressed assets", () => {
    expect(getCacheControlHeader("/assets/index-a1b2c3.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("revalidates the SPA shell", () => {
    expect(getCacheControlHeader("/")).toBe(REVALIDATE_CACHE_CONTROL);
    expect(getCacheControlHeader("/index.html")).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it("revalidates fixed-name public assets", () => {
    expect(getCacheControlHeader("/favicon.svg")).toBe(
      REVALIDATE_CACHE_CONTROL,
    );
    expect(getCacheControlHeader("/icon-192.png")).toBe(
      REVALIDATE_CACHE_CONTROL,
    );
    expect(getCacheControlHeader("/icon-512.png")).toBe(
      REVALIDATE_CACHE_CONTROL,
    );
    expect(getCacheControlHeader("/sounds/notification.mp3")).toBe(
      REVALIDATE_CACHE_CONTROL,
    );
  });

  it("leaves the legacy service worker route to its explicit handler", () => {
    expect(getCacheControlHeader("/sw.js")).toBeNull();
    expect(getCacheControlHeader("/registerSW.js")).toBeNull();
    expect(getCacheControlHeader("/workbox-abc123.js")).toBeNull();
  });
});
