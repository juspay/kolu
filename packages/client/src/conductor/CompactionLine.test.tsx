// @vitest-environment happy-dom
import {
  type ConductorCompactionRow,
  DEFAULT_CONDUCTOR_STATE,
} from "kolu-common/conductor";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import CompactionLine from "./CompactionLine";

vi.mock("./useConductor", () => ({
  useConductor: () => ({
    state: () => ({ ...DEFAULT_CONDUCTOR_STATE, agentName: "Claude Code" }),
  }),
}));

const row = (
  over: Partial<ConductorCompactionRow>,
): ConductorCompactionRow => ({
  id: "kolu:compaction:c1",
  seq: 1,
  since: "2026-01-01T14:31:00.000Z",
  kind: "compaction",
  state: "done",
  at: 201_000,
  summary: "Two works are open.",
  error: null,
  rules: "sent",
  ...over,
});

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = "";
});

const drawn = (one: ConductorCompactionRow) => {
  dispose = render(() => <CompactionLine row={one} />, document.body);
  const line = document.querySelector<HTMLElement>(
    "[data-testid=conductor-compaction]",
  );
  if (line === null) throw new Error("no compaction line");
  const text = (id: string) =>
    line.querySelector(`[data-testid=${id}]`)?.textContent ?? null;
  return {
    line,
    toggle: () => text("conductor-compaction-toggle"),
    sentence: () => text("conductor-compaction-sentence"),
    summary: () => text("conductor-compaction-summary"),
    unfolds: () => line.querySelector("details") !== null,
    open: () => line.querySelector("details")?.open ?? false,
  };
};

describe("the compaction line", () => {
  it("running: one line at the count it began at, and nothing under it", () => {
    const seen = drawn(row({ state: "running", summary: null, rules: null }));
    expect(seen.line.dataset.state).toBe("running");
    expect(seen.toggle()).toContain("compacting at 201k");
    expect(seen.sentence()).toBeNull();
    expect(seen.unfolds()).toBe(false);
  });

  it("done: folded, and unfolds to whether the rules were sent and the summary", () => {
    const seen = drawn(row({}));
    expect(seen.toggle()).toContain("compacted at 201k");
    expect(seen.unfolds()).toBe(true);
    expect(seen.open()).toBe(false);
    expect(seen.sentence()).toBe(
      "Claude Code replaced the conversation above with this summary. The rules were sent again.",
    );
    expect(seen.summary()).toBe("Two works are open.");
  });

  it("done after a compaction nobody saw coming: the rules ride the next message", () => {
    const seen = drawn(row({ rules: "next", at: null }));
    expect(seen.toggle()).toContain("compacted");
    expect(seen.toggle()).not.toContain(" at ");
    expect(seen.sentence()).toBe(
      "Claude Code replaced the conversation above with this summary. The rules go out again with the next message.",
    );
  });

  it("failed: the agent's reason under the line, with nothing to unfold", () => {
    const seen = drawn(
      row({
        state: "failed",
        summary: null,
        rules: null,
        error: "the summary request was refused (overloaded)",
      }),
    );
    expect(seen.toggle()).toContain("could not compact");
    expect(seen.sentence()).toBe(
      "Claude Code tried to compact this conversation and could not: the summary request was refused (overloaded).",
    );
    expect(seen.summary()).toBeNull();
    expect(seen.unfolds()).toBe(false);
  });
});
