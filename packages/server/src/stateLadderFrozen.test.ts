import { workDirOf } from "kolu-conductor";
import { workIdOf } from "kolu-work";
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

describe("the 1.53.0 rung's frozen encodings", () => {
  it("writes the ids kolu-work writes", () => {
    for (const key of KEYS) expect(workIdOf_1_53_0(key)).toBe(workIdOf(key));
  });

  it("names the kept-file directories kolu-work names", () => {
    for (const key of KEYS) {
      const id = workIdOf_1_53_0(key);
      expect(workDirOf_1_53_0(id)).toBe(workDirOf(id));
    }
  });
});
