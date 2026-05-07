import { isLegacyWorkboxCacheName } from "kolu-common/legacyWorkboxCache";
import { describe, expect, it } from "vitest";
import { LEGACY_SERVICE_WORKER } from "./legacyServiceWorker";

describe("LEGACY_SERVICE_WORKER", () => {
  it("activates immediately and removes the old PWA cache owner", () => {
    expect(LEGACY_SERVICE_WORKER).toContain("self.skipWaiting()");
    expect(LEGACY_SERVICE_WORKER).toContain("self.registration.unregister()");
    expect(LEGACY_SERVICE_WORKER).toContain("isLegacyWorkboxCacheName");
    expect(LEGACY_SERVICE_WORKER).toContain("client.navigate(client.url)");
  });
});

describe("isLegacyWorkboxCacheName", () => {
  it("matches Workbox-owned caches without claiming unrelated caches", () => {
    expect(
      isLegacyWorkboxCacheName("workbox-precache-v2-https://kolu.example/"),
    ).toBe(true);
    expect(isLegacyWorkboxCacheName("custom-precache-v1")).toBe(true);
    expect(isLegacyWorkboxCacheName("app-data-v1")).toBe(false);
  });
});
