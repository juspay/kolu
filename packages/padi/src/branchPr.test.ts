/**
 * THE BRANCH'S PULL REQUEST, read the way a work reads it — over a REAL git
 * repository and a stand-in `gh`, so the test exercises the whole path the
 * daemon serves: the remote resolved off the checkout, the forge dispatch that
 * routes on it, the `gh pr view` spawn, and the frames the stream hands out.
 *
 * The stand-in is the one the e2e harness uses (`packages/tests/support/
 * fake-gh.ts`) in miniature — it answers `pr view --json` from a file in the
 * repo root and refuses anything else, which is what makes "the sensor started
 * asking a different question" a failure rather than a silent `absent`.
 */

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

/** The fake `gh`, as a node script: it prints the repo's fixture file when
 *  there is one and answers gh's own "no pull requests found" when there is
 *  not — the sentence the gh adapter classifies as `absent`. */
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

/** State the pull request this repo's `gh` answers with. */
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
    }),
  );
};

/** The first frame this subscription yields — the snapshot, which is the
 *  branch's pull request as it stands. */
const firstFrame = (branch: string): Promise<unknown> =>
  Effect.runPromise(
    Stream.runHead(branchPrStream({ repoPath: repo, branch }, log)).pipe(
      Effect.map((head) => (head._tag === "Some" ? head.value : null)),
    ),
  );

/** The stand-in is staged ONCE, outside the repositories: the gh adapter
 *  resolves `KOLU_GH_BIN` lazily and remembers it, so a binary that moved with
 *  each test's temp repo would read as "gh is not installed" from the second
 *  test on. */
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
    // ASKED ABOUT THE BRANCH BY NAME, not about whatever `repoPath` happens
    // to have checked out: a work's repository is usually a main checkout
    // sitting on master, and gh asked there without a branch answers about
    // master (#2376).
    expect(fs.readFileSync(path.join(repo, ".kolu-gh-argv"), "utf8")).toMatch(
      /^pr view fix-the-parser --json /,
    );
  });

  it("says ABSENT for a branch the forge has no pull request for", async () => {
    // No fixture: the stand-in answers exactly what gh answers, and the
    // adapter classifies it as "no PR can exist here" rather than as a
    // failure — which is a reading a work's timeline learns nothing from.
    expect(await firstFrame("fix-the-parser")).toEqual({ kind: "absent" });
  });

  it("says UNSUPPORTED for a remote no adapter serves, without asking gh", async () => {
    // The remote is resolved off the CHECKOUT, and the dispatch routes on it:
    // a non-GitHub remote never reaches `gh` (a repo with one would make the
    // stand-in exit 2 and this read `unavailable` instead).
    git("remote", "set-url", "origin", "https://codeberg.org/kolu/kolu.git");
    statePr({ number: 181, state: "OPEN" });
    expect(await firstFrame("fix-the-parser")).toEqual({
      kind: "unsupported",
    });
  });
});
