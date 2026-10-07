import { describe, expect, it } from "vitest";
import { parseUpdaterProgressLine } from "./updaterProgress.ts";

describe("parseUpdaterProgressLine", () => {
  it("reads a progress line", () => {
    expect(
      parseUpdaterProgressLine(
        '{"progress":{"done":1100000000,"total":2000000000}}',
      ),
    ).toEqual({ done: 1_100_000_000, total: 2_000_000_000 });
  });

  it("ignores everything else the updater prints", () => {
    for (const line of [
      "",
      "agent-distro: vanilla updated nothing -> /nix/store/x",
      '{"result":"updated"}',
      '{"progress":{"done":"1","total":2}}',
      '{"progress":{"done":-1,"total":2}}',
      "{not json",
    ])
      expect(parseUpdaterProgressLine(line)).toBeNull();
  });
});
