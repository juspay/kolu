import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Stream } from "effect";
import type { Logger } from "pino";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { branchPrStream } from "./branchPr.ts";

const log = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
} as unknown as Logger;

const HEAD = "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3";

const FAKE_GH = `#!${process.execPath}
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const json = argv.indexOf("--json");
if (argv[0] !== "pr" || argv[1] !== "view" || json < 2 || json > 3) {
  process.stderr.write("fake gh: unexpected call: " + argv.join(" ") + "\\n");
  process.exit(2);
}
fs.writeFileSync(path.join(process.cwd(), ".kolu-gh-argv"), argv.join(" "));
const fixture = path.join(process.cwd(), ".kolu-pr.json");
if (!fs.existsSync(fixture)) {
  process.stderr.write("no pull requests found for branch \\"x\\"\\n");
  process.exit(1);
}
process.stdout.write(fs.readFileSync(fixture, "utf8"));
`;

let repo: string;
let ghDir: string;
let ghWas: string | undefined;

const git = (...args: string[]): void => {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
};

const statePr = (over: {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  checks?: ReadonlyArray<{ name: string; conclusion: string }>;
}): void => {
  fs.writeFileSync(
    path.join(repo, ".kolu-pr.json"),
    JSON.stringify({
      number: over.number,
      title: "fix the parser",
      url: `https://github.com/kolu/kolu/pull/${over.number}`,
      state: over.state,
      statusCheckRollup: (over.checks ?? []).map((one) => ({
        __typename: "CheckRun",
        name: one.name,
        status: "COMPLETED",
        conclusion: one.conclusion,
      })),
      reviewDecision: "",
      mergeStateStatus: "UNKNOWN",
      headRefOid: HEAD,
      isDraft: false,
    }),
  );
};

const firstFrame = (branch: string): Promise<unknown> =>
  Effect.runPromise(
    Stream.runHead(branchPrStream({ repoPath: repo, branch }, log)).pipe(
      Effect.map((head) => (head._tag === "Some" ? head.value : null)),
    ),
  );

beforeAll(() => {
  ghDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-branch-pr-bin-"));
  const bin = path.join(ghDir, "gh");
  fs.writeFileSync(bin, FAKE_GH, { mode: 0o755 });
  ghWas = process.env.KOLU_GH_BIN;
  process.env.KOLU_GH_BIN = bin;
});

afterAll(() => {
  if (ghWas === undefined) delete process.env.KOLU_GH_BIN;
  else process.env.KOLU_GH_BIN = ghWas;
  fs.rmSync(ghDir, { recursive: true, force: true });
});

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-branch-pr-"));
  git("init", "--initial-branch=fix-the-parser");
  git("remote", "add", "origin", "https://github.com/kolu/kolu.git");
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("the pull request of a branch", () => {
  it("answers the forge's reading for the branch it is asked about", async () => {
    statePr({
      number: 181,
      state: "MERGED",
      checks: [{ name: "build", conclusion: "SUCCESS" }],
    });
    expect(await firstFrame("fix-the-parser")).toMatchObject({
      kind: "ok",
      value: {
        number: 181,
        state: "merged",
        checks: "pass",
        headSha: HEAD,
      },
    });
    expect(fs.readFileSync(path.join(repo, ".kolu-gh-argv"), "utf8")).toMatch(
      /^pr view fix-the-parser --json /,
    );
  });

  it("says ABSENT for a branch the forge has no pull request for", async () => {
    expect(await firstFrame("fix-the-parser")).toEqual({ kind: "absent" });
  });

  it("says UNSUPPORTED for a remote no adapter serves, without asking gh", async () => {
    git("remote", "set-url", "origin", "https://codeberg.org/kolu/kolu.git");
    statePr({ number: 181, state: "OPEN" });
    expect(await firstFrame("fix-the-parser")).toEqual({
      kind: "unsupported",
    });
  });
});
