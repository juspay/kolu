import { describe, expect, it } from "vitest";
import { materializeHistoryPage } from "./historyPage.ts";

describe("materializeHistoryPage", () => {
  it("emits a non-empty chunk verbatim", () => {
    expect(materializeHistoryPage("older\n", 100, 50)).toBe("older\n");
  });

  it("materializes an all-blank spanning page as blank lines (F10 fidelity)", () => {
    expect(materializeHistoryPage("", 80, 77)).toBe("\n\n\n");
  });

  it("skips an empty page that spans zero rows", () => {
    expect(materializeHistoryPage("", 80, 80)).toBeNull();
  });

  it("skips an empty self-seeded first page (before undefined, span unknown)", () => {
    expect(materializeHistoryPage("", undefined, 40)).toBeNull();
  });

  it("assembles content → blank span → content oldest-first, with exact blank count", () => {
    const replies = [
      { chunk: "c-new\n", before: 100 as number | undefined, topLine: 94 },
      { chunk: "", before: 94 as number | undefined, topLine: 92 },
      { chunk: "c-old\n", before: 92 as number | undefined, topLine: 80 },
    ];
    const pages: string[] = [];
    for (const r of replies) {
      const page = materializeHistoryPage(r.chunk, r.before, r.topLine);
      if (page !== null) pages.push(page);
    }
    expect(pages.slice().reverse()).toEqual(["c-old\n", "\n\n", "c-new\n"]);
    expect(pages[1]).toBe("\n\n");
    expect(pages).toHaveLength(3);
  });
});
