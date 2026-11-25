/**
 * A BRANCH WORK'S FOLDER IS GIT'S ANSWER FOR ITS KEY — never a member's.
 *
 * A walk over member readings standing anywhere (any folder, any host) and
 * git's checkout readings, interleaved at random: the work's folder is always
 * what the last `repository` answer said. And a member standing in a foreign
 * folder that holds its own `.waterfall/plan.md` lends the work nothing: the
 * listing is asked of the work's folder on the key's host.
 */

import { setImmediate as settle } from "node:timers/promises";
import type { BranchCheckout } from "@kolu/padi-client/surface";
import { Option } from "effect";
import type { Work, WorkId, WorkWorktree } from "kolu-work";
import { seeded } from "kolu-work/seeded";
import { describe, expect, it } from "vitest";
import type { WatchObservation } from "./observation.ts";
import { type WorkRig, workRig } from "./workRig.testlib.ts";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/repo",
  branch: "csv",
  repoBy: "git",
} as const;

/** One reading of a member terminal, standing in `folder` (or nowhere). */
const seeing = (
  ref: string,
  level: "working" | "stopped" | "asking",
  folder: string | null,
): WatchObservation => {
  const cut = ref.lastIndexOf("/");
  return {
    ref,
    host: ref.slice(0, cut),
    terminalId: ref.slice(cut + 1),
    hostName: ref.slice(0, cut),
    name: ref,
    agent: "omp",
    level,
    foregroundShell: false,
    git: folder === null ? null : { worktree: folder },
  };
};

const workOf = (r: WorkRig, id: WorkId): Work =>
  Option.getOrThrow(r.works.get(id));

describe("a branch work's folder", () => {
  it("is the last checkout answer, whatever its members' readings say", () => {
    const REFS = ["local/a", "local/b", "remote:box/c"] as const;
    const FOLDERS = [
      "/repo",
      "/repo/.worktrees/csv",
      "/repo/.worktrees/other",
      "/elsewhere",
      null,
    ] as const;
    const ANSWERS: ReadonlyArray<BranchCheckout> = [
      { kind: "repository", root: "/repo", checkout: { kind: "none" } },
      {
        kind: "repository",
        root: "/repo",
        checkout: { kind: "at", path: "/repo/.worktrees/csv" },
      },
      {
        kind: "repository",
        root: "/repo",
        checkout: { kind: "at", path: "/repo" },
      },
      { kind: "not-a-repository" },
      { kind: "unavailable", reason: "git hung" },
    ];
    for (let seed = 1; seed <= 100; seed += 1) {
      const pick = seeded(seed);
      const among = <T>(of: ReadonlyArray<T>): T =>
        of[Math.floor(pick() * of.length)] as T;
      const r = workRig();
      const id = r.works.openFor({
        key: KEY,
        title: "csv",
        request: { kind: "none" },
      }).id;
      r.works.join(id, "local/a", "planner", "asked");
      r.works.join(id, "local/b", "implementor", "asked");
      r.works.join(id, "remote:box/c", "other", "asked");
      let want: WorkWorktree = { kind: "unread" };
      for (let step = 0; step < 40; step += 1) {
        if (pick() < 0.6) {
          r.watch.observe([
            seeing(
              among(REFS),
              among(["working", "stopped", "asking"]),
              among(FOLDERS),
            ),
          ]);
        } else {
          const answer = among(ANSWERS);
          r.watch.observedCheckout(id, answer);
          if (answer.kind === "repository")
            want =
              answer.checkout.kind === "at"
                ? { kind: "at", path: answer.checkout.path }
                : { kind: "absent" };
        }
        expect(workOf(r, id).worktree, `seed ${seed}, step ${step}`).toEqual(
          want,
        );
      }
    }
  });

  it("lists the work's folder on the key's host, never a member's foreign one", async () => {
    const r = workRig();
    const id = r.works.openFor({
      key: KEY,
      title: "csv",
      request: { kind: "none" },
    }).id;
    r.files.holds.set("/repo/.worktrees/other", [".waterfall/plan.md"]);
    r.works.join(id, "remote:box/p", "planner", "asked");
    r.watch.observedCheckout(id, {
      kind: "repository",
      root: "/repo",
      checkout: { kind: "at", path: "/repo/.worktrees/csv" },
    });

    // The planner stands in ANOTHER worktree, on another host, which holds a
    // plan of its own; its level changes, which is what asks for a listing.
    r.watch.observe([
      seeing("remote:box/p", "working", "/repo/.worktrees/other"),
    ]);
    r.watch.observe([
      seeing("remote:box/p", "stopped", "/repo/.worktrees/other"),
    ]);
    await settle();

    expect(r.files.listed.length).toBeGreaterThan(0);
    for (const at of r.files.listed)
      expect(at).toEqual({ host: "local", worktree: "/repo/.worktrees/csv" });
    expect(workOf(r, id).events.filter((one) => one.kind === "file")).toEqual(
      [],
    );

    // ... and the work's own plan, once written, is recorded.
    r.files.holds.set("/repo/.worktrees/csv", [".waterfall/plan.md"]);
    r.watch.observe([
      seeing("remote:box/p", "asking", "/repo/.worktrees/other"),
    ]);
    await settle();
    expect(
      workOf(r, id)
        .events.filter((one) => one.kind === "file")
        .map((one) => (one.kind === "file" ? one.path : "")),
    ).toEqual([".waterfall/plan.md"]);
  });

  it("lists nothing while git has not named the folder", async () => {
    const r = workRig();
    const id = r.works.openFor({
      key: KEY,
      title: "csv",
      request: { kind: "none" },
    }).id;
    r.files.holds.set("/elsewhere", [".waterfall/plan.md"]);
    r.works.join(id, "local/a", "planner", "asked");
    r.watch.observe([seeing("local/a", "working", "/elsewhere")]);
    r.watch.observe([seeing("local/a", "stopped", "/elsewhere")]);
    await settle();
    expect(r.files.listed).toEqual([]);
  });
});
