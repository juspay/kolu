/** Unit coverage for the `kaval-tui history` full-dump page-materialization rule
 *  (F7). The wire path is smoke-tested in `history.test.ts`; this pins the branch
 *  logic — content, an all-blank spanning page, the self-seeded first page — plus
 *  the oldest-first assembly the command emits. */

import { describe, expect, it } from "vitest";
import { materializeHistoryPage } from "./historyPage.ts";

describe("materializeHistoryPage", () => {
  it("emits a non-empty chunk verbatim", () => {
    expect(materializeHistoryPage("older\n", 100, 50)).toBe("older\n");
  });

  it("materializes an all-blank spanning page as blank lines (F10 fidelity)", () => {
    // Empty chunk, but the range spanned before(80) - topLine(77) = 3 rows.
    expect(materializeHistoryPage("", 80, 77)).toBe("\n\n\n");
  });

  it("skips an empty page that spans zero rows", () => {
    expect(materializeHistoryPage("", 80, 80)).toBeNull();
  });

  it("skips an empty self-seeded first page (before undefined, span unknown)", () => {
    expect(materializeHistoryPage("", undefined, 40)).toBeNull();
  });

  it("assembles content → blank span → content oldest-first, with exact blank count", () => {
    // Simulate the pager loop: newest-older first, collected then reversed.
    // Page 1 (newest): content. Page 2: a 2-row blank run. Page 3 (oldest):
    // content. Each page's `before` is the previous reply's topLine.
    const replies = [
      { chunk: "c-new\n", before: 100 as number | undefined, topLine: 94 },
      { chunk: "", before: 94 as number | undefined, topLine: 92 }, // span 2
      { chunk: "c-old\n", before: 92 as number | undefined, topLine: 80 },
    ];
    const pages: string[] = [];
    for (const r of replies) {
      const page = materializeHistoryPage(r.chunk, r.before, r.topLine);
      if (page !== null) pages.push(page);
    }
    // Emitted oldest-first (the command reverses the collected pages).
    expect(pages.slice().reverse()).toEqual(["c-old\n", "\n\n", "c-new\n"]);
    // The blank page contributed exactly its 2-row span — no compression, no drop.
    expect(pages[1]).toBe("\n\n");
    expect(pages).toHaveLength(3);
  });
});
