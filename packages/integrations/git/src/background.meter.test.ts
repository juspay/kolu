import {
  createChildTally,
  installChildMeter,
  readChildren,
  runInChildScope,
} from "kolu-io";
import { beforeAll, describe, expect, it } from "vitest";
import { backgroundGit } from "./background.ts";

describe("backgroundGit under the child meter", () => {
  beforeAll(() => installChildMeter());

  it("tallies a git child to the scope it was asked from", async () => {
    const tally = createChildTally();
    await runInChildScope({ tally, cause: "test" }, () =>
      backgroundGit().raw(["--version"]),
    );
    expect(tally.children).toBe(1);
    expect(tally.runMs).toBeGreaterThan(0);
    const row = readChildren().rows.find((r) => r.kind === "git");
    expect(row?.causes).toEqual([{ cause: "test", count: 1 }]);
  });
});
