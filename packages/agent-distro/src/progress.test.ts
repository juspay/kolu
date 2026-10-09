/** The updater's `--progress` stdout, as agent-distro's `src/update/update.ts`
 *  writes it (lines captured from its `jsonReport`). */

import { describe, expect, it } from "vitest";
import {
  parseUpdaterLine,
  UPDATER_PROGRESS_ARGS,
  updaterLastWord,
} from "./progress.ts";

describe("parseUpdaterLine", () => {
  it("asks for the machine-readable mode", () => {
    expect(UPDATER_PROGRESS_ARGS).toEqual(["--progress"]);
  });

  it("reads a progress line", () => {
    expect(
      parseUpdaterLine('{"progress":{"done":1100000000,"total":2000000000}}'),
    ).toEqual({ progress: { done: 1_100_000_000, total: 2_000_000_000 } });
  });

  it("reads every result shape", () => {
    expect(
      parseUpdaterLine('{"result":"updated","bundle":"/nix/store/x-vanilla"}'),
    ).toEqual({
      result: { result: "updated", bundle: "/nix/store/x-vanilla" },
    });
    expect(
      parseUpdaterLine('{"result":"unchanged","bundle":"/nix/store/x"}'),
    ).toEqual({ result: { result: "unchanged", bundle: "/nix/store/x" } });
    expect(
      parseUpdaterLine(
        '{"result":"skipped","reason":"cache https://cache.nixos.asia/oss not usable; add it to nix.settings substituters/trusted-public-keys"}',
      ),
    ).toEqual({
      result: {
        result: "skipped",
        reason:
          "cache https://cache.nixos.asia/oss not usable; add it to nix.settings substituters/trusted-public-keys",
      },
    });
    expect(
      parseUpdaterLine('{"result":"failed","reason":"nix build exit 1"}'),
    ).toEqual({ result: { result: "failed", reason: "nix build exit 1" } });
  });

  it("reads a failure's optional `detail` — nix's own line", () => {
    expect(
      parseUpdaterLine(
        `{"result":"failed","reason":"cannot resolve flake","detail":"unable to download 'https://api.github.com/repos/o/r/commits/HEAD': HTTP error 401"}`,
      ),
    ).toEqual({
      result: {
        result: "failed",
        reason: "cannot resolve flake",
        detail:
          "unable to download 'https://api.github.com/repos/o/r/commits/HEAD': HTTP error 401",
      },
    });
    expect(
      parseUpdaterLine(
        '{"result":"skipped","reason":"cache not usable","detail":"x"}',
      ),
    ).toEqual({
      result: { result: "skipped", reason: "cache not usable", detail: "x" },
    });
  });

  it("a `detail` that is not a string is ignored, not malformed", () => {
    for (const detail of ["1", "null", '{"a":1}', '["x"]'])
      expect(
        parseUpdaterLine(
          `{"result":"failed","reason":"cannot resolve flake","detail":${detail}}`,
        ),
      ).toEqual({
        result: { result: "failed", reason: "cannot resolve flake" },
      });
  });

  it("a blank line is nothing", () => {
    expect(parseUpdaterLine("")).toBeNull();
    expect(parseUpdaterLine("   ")).toBeNull();
  });

  it("any other line is MALFORMED — stdout is JSON-only under --progress", () => {
    for (const line of [
      "agent-distro: vanilla updated nothing -> /nix/store/x",
      '{"result":"updated"}',
      '{"result":"skipped"}',
      '{"result":"bogus","reason":"x"}',
      '{"progress":{"done":"1","total":2}}',
      '{"progress":{"done":-1,"total":2}}',
      '{"progress":null}',
      '{"other":1}',
      "null",
      "{not json",
    ])
      expect(parseUpdaterLine(line)).toEqual({ malformed: line });
  });
});

describe("updaterLastWord — the cause from the updater's stderr", () => {
  it("takes the last non-blank line, without the updater's `agent-distro:` prefix", () => {
    expect(
      updaterLastWord([
        "agent-distro: fetching vanilla",
        "agent-distro: vanilla update skipped: cache not usable",
        "  ",
      ]),
    ).toBe("vanilla update skipped: cache not usable");
  });
  it("keeps a line the updater did not prefix as it is", () => {
    expect(updaterLastWord(["TypeError: boom"])).toBe("TypeError: boom");
  });
  it("nothing said is undefined", () => {
    expect(updaterLastWord(["", " "])).toBeUndefined();
  });
});
