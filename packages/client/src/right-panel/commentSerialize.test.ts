import { describe, expect, it } from "vitest";
import { type Comment, serializeComments } from "./commentSerialize";

const sample = (overrides: Partial<Comment> = {}): Comment => ({
  id: "c1",
  path: "src/foo.ts",
  startLine: 10,
  endLine: 10,
  text: "tighten this",
  createdAt: 0,
  ...overrides,
});

describe("serializeComments", () => {
  it("wraps with the versioned header so agents can detect the payload shape", () => {
    const out = serializeComments([sample()]);
    expect(out.startsWith("[kolu comments v1]\n\n")).toBe(true);
  });

  it("renders a Markdown bullet per comment with a code-spanned path:Lrange ref", () => {
    expect(
      serializeComments([
        sample({ startLine: 12, endLine: 18, text: "shorten" }),
      ]),
    ).toBe("[kolu comments v1]\n\n- `src/foo.ts:L12-18` — shorten\n");
  });

  it("emits single-line refs as Lstart (no -end suffix)", () => {
    expect(serializeComments([sample({ startLine: 42, endLine: 42 })])).toBe(
      "[kolu comments v1]\n\n- `src/foo.ts:L42` — tighten this\n",
    );
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
    expect(out).toBe(
      "[kolu comments v1]\n\n- `src/aaa.ts:L7` — A\n- `src/aaa.ts:L100` — C\n- `src/zzz.ts:L5` — B\n",
    );
  });

  it("emits the header even when the list is empty (consumers can detect a no-op flush)", () => {
    expect(serializeComments([])).toBe("[kolu comments v1]\n\n\n");
  });
});
