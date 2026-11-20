import { type WorkKey, workIdOf } from "kolu-work";
import { describe, expect, it } from "vitest";
import { workDirOf } from "./workFiles.ts";

const KEY: WorkKey = {
  kind: "branch",
  host: "remote:naiveintent",
  repo: "/home/me/code/kolu",
  branch: "agent-distro-update-errors",
};
const ID = workIdOf(KEY);

describe("the directory a work's kept files sit in", () => {
  it("names one that is filesystem-safe", () => {
    expect(workDirOf(ID)).toMatch(/^[0-9a-f]{16}$/);
    expect(workDirOf(ID)).toBe(workDirOf(ID));
    expect(workDirOf(ID)).not.toBe(workDirOf(`${ID}x`));
  });
});
