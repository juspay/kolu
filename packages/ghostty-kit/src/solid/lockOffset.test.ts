import { describe, expect, it } from "vitest";
import { createEngine } from "../index.ts";
import { lineText } from "../styled.ts";
import { adjustLockedViewOffset, repinLockedViewOffset } from "./lockOffset.ts";

describe("adjustLockedViewOffset", () => {
  it("advances the window by the totalRows growth, without restyling", () => {
    expect(adjustLockedViewOffset(10, 80, 85, 24, "held", [])).toBe(15);
  });

  it("repins a drifted window so the held line is the first visible row", () => {
    const eng = createEngine({ cols: 20, rows: 4, scrollback: 40 });
    try {
      for (let i = 0; i < 20; i++)
        eng.write(`hold-${String(i).padStart(2, "0")}\r\n`);
      const full = eng.styledLines({ kind: "full" });
      const held = lineText(full[8] ?? { runs: [] });
      const pinned = repinLockedViewOffset(4, held, full);
      expect(pinned).not.toBeNull();
      const start = full.length - 4 - (pinned ?? 0);
      expect(lineText(full[start] ?? { runs: [] })).toBe(held);
    } finally {
      eng.free();
    }
  });

  it("re-pins the held line after a wasm prune shrinks the buffer", () => {
    const eng = createEngine({ cols: 80, rows: 5, scrollback: 40 });
    try {
      const fat = "x".repeat(70);
      let sawPrune = false;
      for (let i = 0; i < 2000; i++) {
        const beforeSnap =
          i > 50 ? eng.styledLines({ kind: "full" }) : undefined;
        const held = beforeSnap
          ? lineText(beforeSnap[beforeSnap.length - 1] ?? { runs: [] })
          : "";
        const beforeTotal = eng.totalRows();
        eng.write(`${fat}-keep-${i}\r\n`);
        const afterTotal = eng.totalRows();
        if (beforeSnap && held.length > 0 && afterTotal < beforeTotal) {
          sawPrune = true;
          const after = eng.styledLines({ kind: "full" });
          const next = adjustLockedViewOffset(
            7,
            beforeTotal,
            afterTotal,
            5,
            held,
            after,
          );
          const start = Math.max(0, after.length - 5 - next);
          const window = after.slice(start, start + 5).map((l) => lineText(l));
          expect(window).toContain(held);
          break;
        }
      }
      expect(sawPrune).toBe(true);
    } finally {
      eng.free();
    }
  });
});
