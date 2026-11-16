import { execFile, execFileSync, spawn } from "node:child_process";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type ChildKindRow,
  childKind,
  createChildTally,
  installChildMeter,
  meterSyncChild,
  readChildren,
  runInChildScope,
} from "./child-meter.ts";

function rowOf(kind: string): ChildKindRow {
  const row = readChildren().rows.find((r) => r.kind === kind);
  if (!row) throw new Error(`no child row of kind ${kind}`);
  return row;
}

function run(file: string, args: string[]): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  execFile(file, args, () => resolve());
  return promise;
}

describe("childKind", () => {
  it("names a git child by its subcommand, past the global options", () => {
    expect(
      childKind([
        "git",
        "-c",
        "core.quotePath=false",
        "-C",
        "/repo",
        "--no-pager",
        "diff",
        "--name-status",
        "HEAD",
      ]),
    ).toBe("git diff");
  });

  it("names a gh child by two words, whatever its path and branch", () => {
    expect(
      childKind([
        "/nix/store/abc-gh-2.60/bin/gh",
        "pr",
        "view",
        "some/branch",
        "--json",
        "number,title",
      ]),
    ).toBe("gh pr view");
  });

  it("names an osfacts child by one word", () => {
    expect(
      childKind([
        "/nix/store/x-osfacts/bin/osfacts",
        "snapshot",
        "--pids",
        "1",
      ]),
    ).toBe("osfacts snapshot");
  });

  it("names any other program by its basename alone", () => {
    expect(childKind(["/usr/bin/ps", "-A", "-o", "pid=,ppid="])).toBe("ps");
  });
});

describeDaemon("child meter at the spawn seam", () => {
  beforeAll(() => installChildMeter());

  it("refuses a second install", () => {
    expect(() => installChildMeter()).toThrow(/already installed/);
  });

  it("sees a real child: its start call and its run", async () => {
    await run("sleep", ["0.3"]);
    const row = rowOf("sleep");
    expect(row.started).toBeGreaterThanOrEqual(1);
    expect(row.startCall.kind).toBe("measured");
    if (row.startCall.kind === "measured") {
      expect(row.startCall.value.maxMs).toBeGreaterThan(0);
    }
    expect(row.run.kind).toBe("measured");
    if (row.run.kind === "measured") {
      expect(row.run.value.maxMs).toBeGreaterThanOrEqual(300);
    }
  });

  it("counts a program that does not exist as failed to start", async () => {
    const failed = Promise.withResolvers<void>();
    spawn("kolu-no-such-program-xyz", []).on("error", () => failed.resolve());
    await failed.promise;
    const row = rowOf("kolu-no-such-program-xyz");
    expect(row.failedToStart).toBe(1);
    expect(row.running).toBe(0);
  });

  it("counts a sync child whose program is missing as failed, and one that exits non-zero as run", () => {
    const missing = ["kolu-no-such-sync-program-xyz"];
    expect(() =>
      meterSyncChild(missing, () => execFileSync(missing[0] as string)),
    ).toThrow();
    expect(rowOf("kolu-no-such-sync-program-xyz").failedToStart).toBe(1);

    expect(() =>
      meterSyncChild(["false"], () => execFileSync("false")),
    ).toThrow();
    const ran = rowOf("false");
    expect(ran.failedToStart).toBe(0);
    expect(ran.run.kind).toBe("measured");
  });

  it("adds a scoped child to the scope's tally and carries its cause", async () => {
    const tally = createChildTally();
    await runInChildScope({ cause: "poll", tally }, () =>
      run("true", []).then(() => run("true", [])),
    );
    expect(tally.children).toBe(2);
    expect(tally.runMs).toBeGreaterThan(0);
    expect(rowOf("true").causes).toEqual([{ cause: "poll", count: 2 }]);
  });
});
