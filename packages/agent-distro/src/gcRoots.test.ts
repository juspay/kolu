/** The GC-root names kolu-server writes and padi prunes. */

import { describe, expect, it } from "vitest";
import { PACKAGE_GC_ROOT, profileGcRoot, staleGcRoots } from "./gcRoots.ts";

describe("GC roots", () => {
  it("names a profile's root by its reference, stably", () => {
    expect(profileGcRoot("github:juspay/skills")).toBe(
      profileGcRoot("github:juspay/skills"),
    );
    expect(profileGcRoot("github:juspay/skills")).toMatch(
      /^profile-[0-9a-f]{16}$/,
    );
    expect(profileGcRoot("~/a")).not.toBe(profileGcRoot("~/b"));
  });

  it("keeps the package's root and the kept stacks' — everything else goes, a bare legacy name included", () => {
    const kept = profileGcRoot("github:juspay/skills");
    const next = profileGcRoot("~/src/new");
    const gone = profileGcRoot("~/src/old");
    expect(
      staleGcRoots(
        [PACKAGE_GC_ROOT, kept, next, gone, "vanilla"],
        ["github:juspay/skills", "~/src/new"],
      ),
    ).toEqual([gone, "vanilla"]);
    expect(staleGcRoots([PACKAGE_GC_ROOT, kept], [])).toEqual([kept]);
  });
});
