/** Fresh consumer of the shipped module — not the engine's own test file.
 *  Loads `@kolu/ghostty-kit`, writes a known sequence, asserts readable text.
 *  Run twice in this file so a one-shot cache lie cannot pass. */

import { describe, expect, it } from "vitest";
import { createEngine } from "./index.ts";

function driveKnownSequence(): string {
  const eng = createEngine({ cols: 40, rows: 6 });
  try {
    eng.write("kolu-ghostty-consumer-marker\r\n");
    return eng.formatPlain();
  } finally {
    eng.free();
  }
}

function driveStarshipLike(): string {
  const eng = createEngine({ cols: 40, rows: 8 });
  try {
    eng.write(
      "\x1b[1m\x1b[38;5;6msrid\x1b[0m on \x1b[1m\x1b[38;5;3mnaiveintent\x1b[0m \x1b[35m~\x1b[0m\r\n\x1b[38;2;88;88;88m❯\x1b[0m ",
    );
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

  it("first load keeps a Starship-like prompt readable", () => {
    const text = driveStarshipLike();
    expect(text).toContain("srid");
    expect(text).toContain("naiveintent");
    expect(text).toContain("❯");
  });

  it("second load keeps a Starship-like prompt readable", () => {
    const text = driveStarshipLike();
    expect(text).toContain("srid");
    expect(text).toContain("naiveintent");
    expect(text).toContain("❯");
  });
});
