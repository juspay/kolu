import { describe, expect, it } from "vitest";
import { getCacheControlHeader } from "./cacheControl";

describe("getCacheControlHeader", () => {
  it("pins Vite content-addressed assets", () => {
    expect(getCacheControlHeader("/assets/index-a1b2c3.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("revalidates the SPA shell", () => {
    expect(getCacheControlHeader("/")).toBe("no-cache, must-revalidate");
    expect(getCacheControlHeader("/index.html")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("revalidates fixed-name public assets", () => {
    expect(getCacheControlHeader("/favicon.svg")).toBe(
      "no-cache, must-revalidate",
    );
    expect(getCacheControlHeader("/icon-192.png")).toBe(
      "no-cache, must-revalidate",
    );
    expect(getCacheControlHeader("/icon-512.png")).toBe(
      "no-cache, must-revalidate",
    );
    expect(getCacheControlHeader("/sounds/notification.mp3")).toBe(
      "no-cache, must-revalidate",
    );
  });

  it("leaves the legacy service worker route to its explicit handler", () => {
    expect(getCacheControlHeader("/sw.js")).toBeNull();
    expect(getCacheControlHeader("/registerSW.js")).toBeNull();
    expect(getCacheControlHeader("/workbox-abc123.js")).toBeNull();
  });
});
