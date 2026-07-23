/**
 * Structured nix progress (#1962) — parse `--log-format internal-json` events
 * into the human lines the connect overlay's log tail shows during a long copy.
 */
import { describe, expect, it } from "vitest";
import { makeNixProgressReporter } from "./nixProgress";

const ACT_COPY_PATH = 100;
const ACT_COPY_PATHS = 103;
const RES_PROGRESS = 105;

describe("makeNixProgressReporter", () => {
  it("forwards non-@nix lines unchanged (network heuristics still see them)", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    report("ssh: connect to host zest port 22: Connection refused");
    report("copying path '/nix/store/abc-foo' from 'https://cache…'");
    expect(out).toEqual([
      "ssh: connect to host zest port 22: Connection refused",
      "copying path '/nix/store/abc-foo' from 'https://cache…'",
    ]);
  });

  it("surfaces path count from actCopyPaths start", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    report(
      `@nix ${JSON.stringify({
        action: "start",
        id: 1,
        type: ACT_COPY_PATHS,
        text: "copying 12 paths",
        parent: 0,
      })}`,
    );
    expect(out.some((l) => l.includes("12 path"))).toBe(true);
  });

  it("renders byte progress for an in-flight actCopyPath (the silent-NAR case)", () => {
    let now = 0;
    const out: string[] = [];
    const report = makeNixProgressReporter(
      (l) => out.push(l),
      () => now,
    );
    const path = "/nix/store/filjywabc123def456-kolu-1.1.0";
    report(
      `@nix ${JSON.stringify({
        action: "start",
        id: 7,
        type: ACT_COPY_PATH,
        text: `copying path '${path}' from 'https://cache.nixos.org'`,
        fields: [path, "https://cache.nixos.org", "ssh-ng://zest"],
        parent: 0,
      })}`,
    );
    // First path-start emits immediately.
    expect(out.at(-1)).toMatch(/kolu-1\.1\.0/);

    // Mid-transfer progress — force past the throttle.
    now = 600;
    report(
      `@nix ${JSON.stringify({
        action: "result",
        id: 7,
        type: RES_PROGRESS,
        fields: [50 * 1024 * 1024, 260 * 1024 * 1024, 1, 0],
      })}`,
    );
    expect(out.at(-1)).toMatch(/50\.0 MiB of 260\.0 MiB/);
    expect(out.at(-1)).toMatch(/kolu-1\.1\.0/);
  });

  it("throttles high-frequency resProgress so the log tail isn't a firehose", () => {
    let now = 0;
    const out: string[] = [];
    const report = makeNixProgressReporter(
      (l) => out.push(l),
      () => now,
    );
    report(
      `@nix ${JSON.stringify({
        action: "start",
        id: 1,
        type: ACT_COPY_PATH,
        text: "",
        fields: ["/nix/store/aaa-pkg"],
        parent: 0,
      })}`,
    );
    const afterStart = out.length;
    // Ten progress ticks within the throttle window → only the first after start
    // (if different) or none while identical cadence is suppressed.
    for (let i = 1; i <= 10; i++) {
      now = i * 50; // 50ms steps — all inside 500ms throttle
      report(
        `@nix ${JSON.stringify({
          action: "result",
          id: 1,
          type: RES_PROGRESS,
          fields: [i * 1024 * 1024, 100 * 1024 * 1024, 1, 0],
        })}`,
      );
    }
    // At most one progress line inside the first 500ms window (besides the start).
    expect(out.length - afterStart).toBeLessThanOrEqual(1);

    // Past the throttle window after the last emit → a new line lands.
    now = 1_200;
    report(
      `@nix ${JSON.stringify({
        action: "result",
        id: 1,
        type: RES_PROGRESS,
        fields: [80 * 1024 * 1024, 100 * 1024 * 1024, 1, 0],
      })}`,
    );
    expect(out.at(-1)).toMatch(/80\.0 MiB of 100\.0 MiB/);
  });

  it("counts completed paths on stop", () => {
    const out: string[] = [];
    let now = 0;
    const report = makeNixProgressReporter(
      (l) => out.push(l),
      () => now,
    );
    report(
      `@nix ${JSON.stringify({
        action: "start",
        id: 1,
        type: ACT_COPY_PATHS,
        text: "copying 3 paths",
        parent: 0,
      })}`,
    );
    for (const id of [10, 11]) {
      now += 600;
      report(
        `@nix ${JSON.stringify({
          action: "start",
          id,
          type: ACT_COPY_PATH,
          text: "",
          fields: [`/nix/store/hash-pkg${id}`],
          parent: 1,
        })}`,
      );
      now += 600;
      report(`@nix ${JSON.stringify({ action: "stop", id })}`);
    }
    expect(
      out.some((l) => /\d+ paths? done/.test(l) || /path \d+ of 3/.test(l)),
    ).toBe(true);
  });

  it("forwards malformed @nix payloads rather than dropping them", () => {
    const out: string[] = [];
    const report = makeNixProgressReporter((l) => out.push(l));
    report("@nix {not-json");
    expect(out).toEqual(["@nix {not-json"]);
  });
});
