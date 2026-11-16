/**
 * A child-meter scope survives simple-git's own task queue. Most of padi's git
 * children start there, so if the scope were lost on the way in, every padi
 * call would report zero time in children. (Its own file: the meter is
 * installed once per process.)
 */

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
    // `--version` is an option, not a subcommand, so the kind is bare `git`.
    const row = readChildren().rows.find((r) => r.kind === "git");
    expect(row?.causes).toEqual([{ cause: "test", count: 1 }]);
  });
});
