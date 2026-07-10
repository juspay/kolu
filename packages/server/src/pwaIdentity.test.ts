import { describe, expect, it } from "vitest";
import { appName, pwaIdentityForHostname } from "./pwaIdentity";

describe("pwaIdentityForHostname", () => {
  it("derives stable PWA identity from hostname", () => {
    expect(pwaIdentityForHostname("atlas")).toEqual({
      hostname: "atlas",
      name: "Kolu [atlas]",
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

  it("the name is always the SERVER's own host — no remote fold (ALWAYS-MAP)", () => {
    // Under always-map `KOLU_PADI_HOST` seeds a POOL and the canvas boots on the LOCAL
    // default; which host a tab views is a client-side ChromeBar-strip selection, not a
    // server fact — so the identity is the server's own host, byte-identical to a
    // single-host local boot. The old single-host `Kolu [<server> → <remote>]` arrow
    // (which read a comma-seed-list as one remote) is gone.
    expect(appName("pureintent")).toBe("Kolu [pureintent]");
    expect(pwaIdentityForHostname("pureintent").name).toBe("Kolu [pureintent]");
  });
});
