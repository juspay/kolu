import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { RankedDockRow } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { sectionAttentionIds } from "./useSectionAttention";

const parentId = "parent" as TerminalId;
const shellId = "plain-split" as TerminalId;
const agentId = "agent-split" as TerminalId;

const parent: RankedDockRow = {
  id: parentId,
  bucket: "idle",
  pip: "idle",
  asking: false,
  ts: 1,
  subRows: [
    {
      id: shellId,
      kind: "shell",
      bucket: "idle",
      pip: "idle",
      asking: false,
      ts: 1,
      depth: 1,
    },
    {
      id: agentId,
      kind: "agent",
      bucket: "working",
      pip: "working",
      asking: false,
      // A split OF the shell split — the section fold must reach it too, or a
      // nested agent's attention never lands in the header count.
      ts: 1,
      depth: 2,
    },
  ],
};

const group: DockGroup = {
  name: "kolu",
  color: "oklch(50% 0.1 100)",
  topRows: [parent],
  allTopRows: [parent],
  railEntries: [],
};

describe("sectionAttentionIds", () => {
  it("includes every split — shell and agent — so row marks and header agree", () => {
    // Asking still self-excludes agentless ids inside the fold; membership
    // no longer re-gates on kind (that was the chrome-complecting gate).
    expect(sectionAttentionIds(group)).toEqual([parentId, shellId, agentId]);
  });
});
