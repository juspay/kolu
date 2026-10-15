/** The GC-root names kolu-server writes and padi prunes. */

import { describe, expect, it } from "vitest";
import {
  PACKAGE_GC_ROOT,
  profileGcRoot,
  staleProfileRoots,
} from "./gcRoots.ts";

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

  it("finds the profile roots a stack no longer names, never the package's", () => {
    const kept = profileGcRoot("github:juspay/skills");
    const gone = profileGcRoot("~/src/old");
    expect(
      staleProfileRoots(
        [PACKAGE_GC_ROOT, kept, gone, "unrelated"],
        ["github:juspay/skills"],
      ),
    ).toEqual([gone]);
    expect(staleProfileRoots([PACKAGE_GC_ROOT, kept], [])).toEqual([kept]);
  });
});
