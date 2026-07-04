import { describe, expect, it } from "vitest";
import { appName, pwaIdentityForHostname } from "./pwaIdentity";

describe("pwaIdentityForHostname", () => {
  it("derives stable PWA identity from hostname", () => {
    expect(pwaIdentityForHostname("atlas", undefined)).toEqual({
      hostname: "atlas",
      name: "Kolu [atlas]",
      themeColor: "#a21caf",
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
    expect(pwaIdentityForHostname("Atlas", undefined).themeColor).toBe(
      pwaIdentityForHostname("atlas", undefined).themeColor,
    );
  });

  it("LOCAL binding is byte-identical to today — no arrow, no remote noise", () => {
    // The whole safety contract of ITEM 1: an unbound (local) server's title must
    // not change one byte. Both the omitted-arg default path and an explicit
    // `undefined` remoteHost yield the plain form.
    expect(appName("pureintent", undefined)).toBe("Kolu [pureintent]");
    expect(pwaIdentityForHostname("pureintent", undefined).name).toBe(
      "Kolu [pureintent]",
    );
  });

  it("REMOTE binding carries BOTH identities and reads unambiguously as remote", () => {
    // Under a remote binding the canvas IS the remote host, so the title names both
    // ends with the arrow pointing at the host the canvas became.
    expect(appName("pureintent", "sincereintent")).toBe(
      "Kolu [pureintent → sincereintent]",
    );
    expect(pwaIdentityForHostname("pureintent", "sincereintent").name).toBe(
      "Kolu [pureintent → sincereintent]",
    );
  });

  it("keeps the per-host theme color keyed on the SERVER host, remote or not", () => {
    // Only the NAME carries the remote host; the theme color stays the server's own,
    // so a remote binding never silently repaints unrelated chrome.
    expect(
      pwaIdentityForHostname("pureintent", "sincereintent").themeColor,
    ).toBe(pwaIdentityForHostname("pureintent", undefined).themeColor);
  });
});
