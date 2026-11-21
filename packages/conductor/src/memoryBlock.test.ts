import type { Memory } from "kolu-common/conductorMemory";
import { describe, expect, it } from "vitest";
import { memoryBlock } from "./memoryBlock.ts";

const AT = "2026-12-02T09:15:00.000Z";

const memory = (over: Partial<Memory>): Memory => ({
  entries: [],
  proposals: [],
  declined: [],
  next: 1,
  ...over,
});

describe("the memory block", () => {
  it("says an empty memory in one line", () => {
    expect(memoryBlock(memory({}))).toBe(
      "# [kolu] What you remember\n\nNothing yet.",
    );
  });

  it("carries every approved entry, with its about line when it has one", () => {
    expect(
      memoryBlock(
        memory({
          entries: [
            {
              id: "m1",
              title: "Squash-merge on demo-app",
              about: "demo-app",
              body: "Always squash.",
              by: "you",
              edited: false,
              at: AT,
            },
            {
              id: "m2",
              title: "Never merge on a Friday",
              about: null,
              body: "Hand a green pull request over instead.",
              by: "conductor",
              edited: false,
              at: AT,
            },
          ],
        }),
      ),
    ).toBe(
      [
        "# [kolu] What you remember",
        "",
        "## Squash-merge on demo-app",
        "About: demo-app",
        "",
        "Always squash.",
        "",
        "## Never merge on a Friday",
        "",
        "Hand a green pull request over instead.",
      ].join("\n"),
    );
  });

  it("names a waiting proposal by its title only, never as a fact", () => {
    const block = memoryBlock(
      memory({
        proposals: [
          {
            id: "p1",
            change: {
              kind: "add",
              title: "Run the linter before opening a pull request",
              about: "demo-app",
              body: "`just lint` must pass first.",
            },
            why: null,
            at: AT,
            batch: "u1",
          },
        ],
      }),
    );
    expect(block).toBe(
      [
        "# [kolu] What you remember",
        "",
        "Nothing yet.",
        "",
        "## Waiting on the human, not remembered",
        "- Run the linter before opening a pull request",
      ].join("\n"),
    );
    expect(block).not.toContain("just lint");
  });
});
