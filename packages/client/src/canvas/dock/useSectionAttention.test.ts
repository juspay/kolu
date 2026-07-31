import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { RankedDockRow } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { sectionAttentionIds } from "./useSectionAttention";

const parentId = "parent" as TerminalId;
const shellId = "plain-split" as TerminalId;
const agentId = "agent-split" as TerminalId;
const grandchildId = "grandchild-agent" as TerminalId;

const parent: RankedDockRow = {
  id: parentId,
  bucket: "idle",
  pip: "idle",
  ts: 1,
  subRows: [
    {
      id: shellId,
      depth: 1,
      kind: "shell",
      bucket: "idle",
      pip: "idle",
      ts: 1,
    },
    {
      id: agentId,
      depth: 1,
      kind: "agent",
      bucket: "working",
      pip: "working",
      ts: 1,
    },
    // A GRANDCHILD — the flat pre-order list carries depth, so section
    // attention must see it too (it could not exist before TR3).
    {
      id: grandchildId,
      depth: 2,
      kind: "agent",
      bucket: "awaiting",
      pip: "awaiting",
      ts: 1,
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
    // Every DESCENDANT joins, at any depth — the flat pre-order list is what
    // makes a grandchild reachable here at all.
    expect(sectionAttentionIds(group)).toEqual([
      parentId,
      shellId,
      agentId,
      grandchildId,
    ]);
  });
});
