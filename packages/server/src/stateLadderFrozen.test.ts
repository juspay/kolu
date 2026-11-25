/**
 * THE FROZEN 1.53.0 ENCODINGS, PINNED AGAINST THE LIVE ONES.
 *
 * The 1.53.0 rung writes work ids into the store and names the directories it
 * moves kept files into, and it does both through its OWN copies of
 * `kolu-work`'s encodings (`stateLadder.ts`) — because a rung that has run on
 * somebody's store may never change what it produces, and `kolu-work` is free
 * to move. This test says the copies are faithful TODAY: that the freeze was
 * a copy and not a rewrite.
 *
 * IF `kolu-work`'s encoding EVER CHANGES, THIS TEST IS DELETED — not "fixed".
 * Making the frozen copy follow the live one would be exactly the bug the
 * copy exists to prevent: the rung must keep producing the bytes it was
 * proven against, so a divergence is the live side moving on, and the only
 * honest response is to stop comparing them.
 */

import { workDirOf } from "kolu-conductor";
import { type WorkKey, workIdOf } from "kolu-work";
import { describe, expect, it } from "vitest";
import {
  type WorkKey_1_53_0,
  workDirOf_1_53_0,
  workIdOf_1_53_0,
} from "./stateLadder.ts";

const KEYS: ReadonlyArray<WorkKey_1_53_0> = [
  {
    kind: "branch",
    host: "local",
    repo: "/home/sri/code/kolu",
    branch: "main",
  },
  {
    kind: "branch",
    host: "pu",
    repo: "/code/with space/repo",
    branch: "feat/two slashes",
  },
  { kind: "branch", host: "local", repo: "", branch: "" },
  { kind: "watch", terminal: "local/abc-123" },
  { kind: "watch", terminal: "pu/term with space" },
];

/** The same key in today's shape: a branch key also says who named its
 *  repository (which the id never reads), and a watch holds its terminal's
 *  host and id as two fields, split at the ref's LAST `/`. The bytes of the
 *  id are the same — that is what this pins. */
const liveKey = (key: WorkKey_1_53_0): WorkKey => {
  if (key.kind === "branch") return { ...key, repoBy: { kind: "as-written" } };
  const cut = key.terminal.lastIndexOf("/");
  return {
    kind: "watch",
    host: key.terminal.slice(0, cut),
    id: key.terminal.slice(cut + 1),
  };
};

describe("the 1.53.0 rung's frozen encodings", () => {
  it("writes the ids kolu-work writes", () => {
    for (const key of KEYS)
      expect(workIdOf_1_53_0(key)).toBe(workIdOf(liveKey(key)));
  });

  it("names the kept-file directories kolu-work names", () => {
    for (const key of KEYS) {
      const id = workIdOf_1_53_0(key);
      expect(workDirOf_1_53_0(id)).toBe(workDirOf(id));
    }
  });
});
