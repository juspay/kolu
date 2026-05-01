import { describe, expect, it } from "vitest";
import { pwaIdentityForHostname } from "./pwaIdentity";

describe("pwaIdentityForHostname", () => {
  it("derives stable PWA identity from hostname", () => {
    expect(pwaIdentityForHostname("atlas")).toEqual({
      hostname: "atlas",
      name: "kolu@atlas",
      themeColor: "#0f766e",
    });
  });

  it("varies theme color by hostname", () => {
    const colors = new Set(
      ["atlas", "boreal", "cygnus", "deneb"].map(
        (hostname) => pwaIdentityForHostname(hostname).themeColor,
      ),
    );

    expect(colors.size).toBeGreaterThan(1);
  });

  it("treats hostname case as the same color seed", () => {
    expect(pwaIdentityForHostname("Atlas").themeColor).toBe(
      pwaIdentityForHostname("atlas").themeColor,
    );
  });
});
