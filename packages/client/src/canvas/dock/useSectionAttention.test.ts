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
  ts: 1,
  subRows: [
    { id: shellId, kind: "shell", bucket: "idle", pip: "idle", ts: 1 },
    {
      id: agentId,
      kind: "agent",
      bucket: "working",
      pip: "working",
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
  it("includes agent splits and excludes shells (section counts only agents)", () => {
    // Shells render a StatePip on their row; they still do not join the
    // section attention fold because a shell cannot ask.
    expect(sectionAttentionIds(group)).toEqual([parentId, agentId]);
  });
});
