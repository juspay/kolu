/**
 * Drop-by-default nix progress filter (#1962 / #1964): only transfer status (+
 * optional building starts) reach the connect tail; raw @nix never leaks.
 */
import { describe, expect, it } from "vitest";
import { makeNixProgressReporter } from "./nixProgress";

const ACT_COPY_PATH = 100;
const ACT_COPY_PATHS = 103;
const ACT_BUILD = 105;
const RES_PROGRESS = 105;
const RES_BUILD_LOG_LINE = 101;

const nix = (o: object): string => `@nix ${JSON.stringify(o)}`;

describe("makeNixProgressReporter", () => {
  it("forwards non-@nix lines unchanged", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    report("zest: checking for a cached agent…");
    report("ssh: connect to host zest port 22: Connection refused");
    expect(out).toEqual([
      "zest: checking for a cached agent…",
      "ssh: connect to host zest port 22: Connection refused",
    ]);
  });

  it("emits a single throttled transfer status line (paths + bytes)", () => {
    let now = 0;
    const out: string[] = [];
    const report = makeNixProgressReporter(
      (l) => out.push(l),
      () => now,
    );
    report(
      nix({
        action: "start",
        id: 1,
        type: ACT_COPY_PATHS,
        text: "copying 6 paths",
      }),
    );
    expect(out.at(-1)).toMatch(/copying 6 paths/);

    report(
      nix({
        action: "start",
        id: 7,
        type: ACT_COPY_PATH,
        fields: ["/nix/store/abc-kolu-1.1.0"],
      }),
    );
    now = 600;
    report(
      nix({
        action: "result",
        id: 7,
        type: RES_PROGRESS,
        fields: [84, 84, 0, 0],
      }),
    );
    expect(out.at(-1)).toMatch(/84 B of 84 B/);
    expect(out.every((l) => !l.startsWith("@nix"))).toBe(true);
  });

  it("NEVER forwards raw @nix JSON — build-log results and unknown events are dropped", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    // The field leak: resBuildLogLine with a dist/ path and ANSI.
    report(
      nix({
        action: "result",
        id: 99,
        type: RES_BUILD_LOG_LINE,
        fields: ["\u001b[32mdist/index.js\u001b[0m"],
      }),
    );
    report(
      nix({
        action: "msg",
        level: 0,
        msg: "some verbosity",
      }),
    );
    report(
      nix({
        action: "start",
        id: 3,
        type: 109, // actQueryPathInfo — not a transfer
        text: "querying info about missing paths",
      }),
    );
    report("@nix {not-json");
    expect(out).toEqual([]); // drop-by-default: nothing leaked
  });

  it("optionally surfaces a building start (drv name only)", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    report(
      nix({
        action: "start",
        id: 2,
        type: ACT_BUILD,
        text: "building '/nix/store/hash-padi.drv'",
      }),
    );
    expect(out).toEqual(["building padi.drv"]);
    expect(out[0]).not.toMatch(/@nix/);
  });

  it("counts completed paths on stop", () => {
    let now = 0;
    const out: string[] = [];
    const report = makeNixProgressReporter(
      (l) => out.push(l),
      () => now,
    );
    report(
      nix({
        action: "start",
        id: 1,
        type: ACT_COPY_PATHS,
        text: "copying 3 paths",
      }),
    );
    for (const id of [10, 11]) {
      now += 600;
      report(
        nix({
          action: "start",
          id,
          type: ACT_COPY_PATH,
          fields: [`/nix/store/hash-pkg${id}`],
        }),
      );
      now += 600;
      report(nix({ action: "stop", id }));
    }
    expect(
      out.some((l) => /\d+ paths? done/.test(l) || /path \d+ of 3/.test(l)),
    ).toBe(true);
  });
});
