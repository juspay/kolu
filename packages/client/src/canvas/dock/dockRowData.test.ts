/** `dockRowLabel` — the ONE author for a dock row's annotation words.
 *
 *  The fold's whole content is the TILE/SPLIT asymmetry: a tile states its
 *  display identity (branch / intent), a split has none of its own and states its
 *  working directory. That asymmetry is exactly what a consumer can get wrong in
 *  silence — the drag ghost read the display projection directly, so every
 *  SPLIT's ghost carried an empty box while the row under it showed words. */

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { dockRowLabel } from "./dockRowData";

/** Only the fields the fold reads; the rest of the record is not reachable from
 *  it (see `shellMeta` in the neighbouring dock tests for the same fixture). */
function meta(over: { intent?: string; cwd?: string } = {}): TerminalMetadata {
  return {
    state: "active",
    cwd: "/tmp/work",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    promptedAt: null,
    ...over,
  };
}

const TILE_INFO: TerminalDisplayInfo = {
  repoColor: "oklch(0.7 0.05 200)",
  annotationColor: "oklch(0.7 0.05 210)",
  subCount: 0,
  key: { group: "kolu", label: "main" },
};

describe("dockRowLabel", () => {
  it("states a TILE's display identity", () => {
    expect(dockRowLabel(meta(), TILE_INFO)).toBe("main");
  });

  it("states a SPLIT's working directory when there is no display row", () => {
    // Display info is keyed on TOP-LEVEL tiles, so a split arrives with
    // `undefined` — and the fold must still produce words.
    expect(dockRowLabel(meta({ cwd: "/tmp/kolu-rehome" }), undefined)).toBe(
      "kolu-rehome",
    );
  });

  it("lets an intent's first line outrank both", () => {
    expect(dockRowLabel(meta({ intent: "ship the dock" }), TILE_INFO)).toBe(
      "ship the dock",
    );
  });
});
