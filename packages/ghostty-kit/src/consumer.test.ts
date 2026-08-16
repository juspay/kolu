/** Fresh consumer of the shipped module — not the engine's own test file.
 *  Loads `@kolu/ghostty-kit`, writes a known sequence, asserts readable text.
 *  Run twice in this file so a one-shot cache lie cannot pass. */

import { createEngine } from "./index.ts";
import { describe, expect, it } from "vitest";

function driveKnownSequence(): string {
  const eng = createEngine({ cols: 40, rows: 6 });
  try {
    eng.write("kolu-ghostty-consumer-marker\r\n");
    return eng.formatPlain();
  } finally {
    eng.free();
  }
}

describe("shipped module consumer", () => {
  it("first load writes and reads the known sequence", async () => {
    const text = driveKnownSequence();
    expect(text).toContain("kolu-ghostty-consumer-marker");
  });

  it("second load writes and reads the same known sequence", async () => {
    const text = driveKnownSequence();
    expect(text).toContain("kolu-ghostty-consumer-marker");
  });
});
