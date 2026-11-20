import * as fs from "node:fs";
import * as path from "node:path";

export const PR_FIXTURE_FILE = ".kolu-e2e-pr.json";

export interface PrFixture {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly checks?: ReadonlyArray<{
    readonly name: string;
    readonly outcome: "pending" | "pass" | "fail";
  }>;
  readonly head?: string;
  readonly mergeState?: "BLOCKED" | "BEHIND" | "CLEAN" | "DIRTY";
  readonly review?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";
  readonly draft?: boolean;
}

function rollupEntry(check: {
  name: string;
  outcome: "pending" | "pass" | "fail";
}): Record<string, string> {
  if (check.outcome === "pending") {
    return {
      __typename: "CheckRun",
      name: check.name,
      status: "IN_PROGRESS",
      conclusion: "",
    };
  }
  return {
    __typename: "CheckRun",
    name: check.name,
    status: "COMPLETED",
    conclusion: check.outcome === "pass" ? "SUCCESS" : "FAILURE",
  };
}

export function statePullRequest(repoRoot: string, pr: PrFixture): void {
  const payload = {
    number: pr.number,
    title: pr.title,
    url: `https://github.com/kolu-e2e/${path.basename(repoRoot)}/pull/${pr.number}`,
    state: pr.state.toUpperCase(),
    statusCheckRollup: (pr.checks ?? []).map(rollupEntry),
    reviewDecision: pr.review ?? "",
    mergeStateStatus:
      pr.state === "open" ? (pr.mergeState ?? "CLEAN") : "UNKNOWN",
    headRefOid: pr.head ?? "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
    isDraft: pr.draft ?? false,
  };
  fs.writeFileSync(
    path.join(repoRoot, PR_FIXTURE_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function source(nodeBin: string): string {
  return `#!${nodeBin}
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const json = argv.indexOf("--json");
if (argv[0] !== "pr" || argv[1] !== "view" || json < 2 || json > 3) {
  process.stderr.write("kolu-e2e fake gh: unexpected call: " + argv.join(" ") + "\\n");
  process.exit(2);
}
const fixture = path.join(process.cwd(), ${JSON.stringify(PR_FIXTURE_FILE)});
if (!fs.existsSync(fixture)) {
  process.stderr.write("no pull requests found for branch \\"" + (process.env.GIT_BRANCH || "e2e") + "\\"\\n");
  process.exit(1);
}
process.stdout.write(fs.readFileSync(fixture, "utf8"));
`;
}

export function stageFakeGh(dir: string, nodeBin: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "gh");
  fs.writeFileSync(bin, source(nodeBin), { mode: 0o755 });
  return bin;
}
