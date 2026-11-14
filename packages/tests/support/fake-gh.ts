/** THE `gh` THE SUITE'S PR SENSOR RUNS.
 *
 *  padi resolves a terminal's pull request by spawning the binary named by
 *  `KOLU_GH_BIN` as `gh pr view --json <fields>` **in the repo root**
 *  (`packages/integrations/github/src/resolve.ts`), and reads what comes back
 *  on stdout. So a scenario can state a PR the same way it states a branch —
 *  by putting a file in the repo — without a network, a token, or a real
 *  GitHub remote behind the `origin` URL.
 *
 *  THE TWO ANSWERS ARE BOTH gh's OWN. With the fixture file present this
 *  prints its bytes and exits 0, which is what `gh pr view --json` does; with
 *  it absent it exits NON-ZERO with `no pull requests found` on stderr, which
 *  is the exact sentence `classifyGhError` matches to classify a branch with
 *  no PR as `absent`. Anything else would classify as `unknown` and the UI
 *  would carry gh's scary "something is wrong" copy instead of nothing — a
 *  difference a scenario asserting "no PR yet" must be able to tell.
 *
 *  The script is written per worker (the harness stages it beside the other
 *  fake binaries) and runs under THIS process's node by absolute path — never
 *  a bare `node`, which resolves differently on a box where node lives only in
 *  the dev shell (`skill://e2e-testing`'s third rule). */

import * as fs from "node:fs";
import * as path from "node:path";

/** The file a scenario writes into a repo to state its pull request. Read by
 *  the fake `gh` from its own cwd, which is the repo root gh is run in — so
 *  two repos in one run never see each other's PR. */
export const PR_FIXTURE_FILE = ".kolu-e2e-pr.json";

/** What a scenario says about the PR, in the vocabulary a person uses. The
 *  gh-shaped JSON is derived from it below, so no scenario has to know
 *  GitHub's rollup grammar. */
export interface PrFixture {
  readonly number: number;
  readonly title: string;
  /** gh's own states; `merged` is the one that ends a piece of work. */
  readonly state: "open" | "closed" | "merged";
  /** The checks, by name and outcome. `[]` is "no checks configured", which
   *  gh reports as an empty rollup and kolu folds to `null`. */
  readonly checks?: ReadonlyArray<{
    readonly name: string;
    readonly outcome: "pending" | "pass" | "fail";
  }>;
  /** The head commit the checks above are about — what a scenario changes
   *  when it wants a PUSH rather than another reading of the same commit (a
   *  work's timeline holds one check event per kind per commit). Defaults to
   *  one commit, so a scenario that never mentions a push never has to. */
  readonly head?: string;
}

/** gh's `statusCheckRollup` entry for one check — a `CheckRun`, the shape
 *  GitHub Actions produces, spelled in GitHub's own status/conclusion pair so
 *  `deriveCheckStatus` classifies it through the production mapping rather
 *  than through a shortcut this fixture invented. */
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

/** State the PR of `repoRoot`: the next `gh pr view` run there answers with
 *  it. Writing the file is the whole statement — the sensor re-reads on its
 *  own (poll, or the branch change `conductor_steps` makes to hurry it). */
export function statePullRequest(repoRoot: string, pr: PrFixture): void {
  const payload = {
    number: pr.number,
    title: pr.title,
    url: `https://github.com/kolu-e2e/${path.basename(repoRoot)}/pull/${pr.number}`,
    state: pr.state.toUpperCase(),
    statusCheckRollup: (pr.checks ?? []).map(rollupEntry),
    // gh's CLI serialization of "no review decision" — the empty string, not
    // JSON null (`prInfoFromGhView` maps it back to null).
    reviewDecision: "",
    mergeStateStatus: pr.state === "open" ? "CLEAN" : "UNKNOWN",
    // The commit gh says the PR is at. A scenario that says nothing about
    // pushes gets the same one every time, which is what makes a second
    // reading of the same checks the same news.
    headRefOid: pr.head ?? "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
  };
  fs.writeFileSync(
    path.join(repoRoot, PR_FIXTURE_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

/** The script's source. Extensionless and written with `require`, so node
 *  reads it as CommonJS wherever the temp dir sits (no package.json above it
 *  to say otherwise). */
function source(nodeBin: string): string {
  return `#!${nodeBin}
"use strict";
// The fake \`gh\` (see support/fake-gh.ts). Answers ONE invocation —
// \`pr view --json <fields>\` — and refuses anything else loudly rather than
// pretending: a sensor that started asking gh a different question must not
// read as "no PR".
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (argv[0] !== "pr" || argv[1] !== "view" || argv[2] !== "--json") {
  process.stderr.write("kolu-e2e fake gh: unexpected call: " + argv.join(" ") + "\\n");
  process.exit(2);
}
const fixture = path.join(process.cwd(), ${JSON.stringify(PR_FIXTURE_FILE)});
if (!fs.existsSync(fixture)) {
  // gh's own words for a branch with no PR — the string classifyGhError
  // matches to answer \`absent\`.
  process.stderr.write("no pull requests found for branch \\"" + (process.env.GIT_BRANCH || "e2e") + "\\"\\n");
  process.exit(1);
}
process.stdout.write(fs.readFileSync(fixture, "utf8"));
`;
}

/** Stage the fake `gh` in `dir` and answer its absolute path — what the
 *  harness puts in the server child's `KOLU_GH_BIN` (padi inherits it from
 *  the server, which is where the PR sensor runs). */
export function stageFakeGh(dir: string, nodeBin: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "gh");
  fs.writeFileSync(bin, source(nodeBin), { mode: 0o755 });
  return bin;
}
