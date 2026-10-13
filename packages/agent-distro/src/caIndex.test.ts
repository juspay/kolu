/** agent-distro's content-addressed index, as kolu-server reads it. */

import { describe, expect, it } from "vitest";
import { caIndexUrl, parseCaIndexEntry } from "./caIndex.ts";

const entry = {
  rev: "cb44dd8115ea07c3b80b263f3992c49a587a4e5f",
  ia: "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro-vanilla",
  ca: "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla",
};

describe("caIndexUrl", () => {
  it("names the latest/ entry for the system and profile", () => {
    expect(
      caIndexUrl(
        "https://raw.githubusercontent.com/juspay/agent-distro/ca-index",
        "x86_64-linux",
        "vanilla",
      ),
    ).toBe(
      "https://raw.githubusercontent.com/juspay/agent-distro/ca-index/latest/x86_64-linux/vanilla.json",
    );
  });
});

describe("parseCaIndexEntry", () => {
  it("reads rev, ia and ca", () => {
    expect(parseCaIndexEntry(JSON.stringify(entry))).toEqual(entry);
  });
  it("throws on an entry with no ca", () => {
    const { ca: _, ...noCa } = entry;
    expect(() => parseCaIndexEntry(JSON.stringify(noCa))).toThrow();
  });
  it("throws on a ca that is not a store path", () => {
    expect(() =>
      parseCaIndexEntry(JSON.stringify({ ...entry, ca: "/tmp/agents" })),
    ).toThrow();
  });
  it("throws on text that is not JSON", () => {
    expect(() => parseCaIndexEntry("<html>404</html>")).toThrow();
  });
});
