import { describe, expect, it } from "vitest";
import {
  type Comment,
  formatLineRange,
  serializeComments,
} from "./commentSerialize";

const sample = (overrides: Partial<Comment> = {}): Comment => ({
  id: "c1",
  path: "src/foo.ts",
  startLine: 10,
  endLine: 10,
  text: "tighten this",
  createdAt: 0,
  ...overrides,
});

describe("formatLineRange", () => {
  it("emits Lstart when start == end (single line)", () => {
    expect(formatLineRange(42, 42)).toBe("L42");
  });
  it("emits Lstart-end when start < end (range)", () => {
    expect(formatLineRange(12, 18)).toBe("L12-18");
  });
});

describe("serializeComments", () => {
  it("wraps with the versioned header so agents can detect the payload shape", () => {
    const out = serializeComments([sample()]);
    expect(out.startsWith("[kolu comments v1]\n\n")).toBe(true);
  });

  it("renders one block per comment with path, range, and quoted text", () => {
    expect(
      serializeComments([
        sample({ startLine: 12, endLine: 18, text: "shorten" }),
      ]),
    ).toBe("[kolu comments v1]\n\nsrc/foo.ts  L12-18\n  > shorten\n");
  });

  it("sorts by (path, startLine) so the paste reads as a repo walk, not click order", () => {
    const out = serializeComments([
      sample({
        id: "b",
        path: "src/zzz.ts",
        startLine: 5,
        endLine: 5,
        text: "B",
      }),
      sample({
        id: "c",
        path: "src/aaa.ts",
        startLine: 100,
        endLine: 100,
        text: "C",
      }),
      sample({
        id: "a",
        path: "src/aaa.ts",
        startLine: 7,
        endLine: 7,
        text: "A",
      }),
    ]);
    const body = out.slice("[kolu comments v1]\n\n".length).trimEnd();
    expect(body).toBe(
      "src/aaa.ts  L7\n  > A\n\nsrc/aaa.ts  L100\n  > C\n\nsrc/zzz.ts  L5\n  > B",
    );
  });

  it("emits the header even when the list is empty (consumers can detect a no-op flush)", () => {
    expect(serializeComments([])).toBe("[kolu comments v1]\n\n\n");
  });
});
