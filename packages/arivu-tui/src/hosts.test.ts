import { describe, expect, it } from "vitest";
import {
  LOCAL_LABEL,
  parseSshConfigHosts,
  resolveFleetHosts,
} from "./hosts.ts";

describe("parseSshConfigHosts", () => {
  it("collects Host aliases in order, de-duplicated", () => {
    const config = [
      "Host alpha",
      "  HostName 10.0.0.1",
      "Host beta gamma",
      "  User toor",
      "Host alpha", // repeat — kept once
    ].join("\n");
    expect(parseSshConfigHosts(config)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("drops wildcard and negation patterns (defaults, not real hosts)", () => {
    const config = [
      "Host *",
      "  ForwardAgent yes",
      "Host prod-*",
      "Host !staging real",
      "Host a?b",
    ].join("\n");
    // `*`, `prod-*`, `!staging`, `a?b` are patterns; only `real` is dial-able.
    expect(parseSshConfigHosts(config)).toEqual(["real"]);
  });

  it("accepts `Host = name`, tabs, and leading indentation; ignores HostName", () => {
    const config = "\tHost\t=\tzest\nHostName should-be-ignored\n  host  pu1";
    expect(parseSshConfigHosts(config)).toEqual(["zest", "pu1"]);
  });

  it("is empty for a config with no Host lines", () => {
    expect(parseSshConfigHosts("# just a comment\nUser me\n")).toEqual([]);
  });
});

describe("resolveFleetHosts", () => {
  it("puts local first, then explicit hosts, then ssh-config aliases", () => {
    const hosts = resolveFleetHosts({
      explicit: ["nix@a"],
      fromSshConfig: ["b"],
      includeLocal: true,
    });
    expect(hosts).toEqual([
      { label: LOCAL_LABEL, ssh: null },
      { label: "nix@a", ssh: "nix@a" },
      { label: "b", ssh: "b" },
    ]);
  });

  it("omits local when includeLocal is false", () => {
    const hosts = resolveFleetHosts({
      explicit: ["a"],
      fromSshConfig: [],
      includeLocal: false,
    });
    expect(hosts).toEqual([{ label: "a", ssh: "a" }]);
  });

  it("de-duplicates a host named on both the command line and the config", () => {
    const hosts = resolveFleetHosts({
      explicit: ["zest", "pu1"],
      fromSshConfig: ["pu1", "zest", "new"],
      includeLocal: false,
    });
    expect(hosts.map((h) => h.label)).toEqual(["zest", "pu1", "new"]);
  });

  it("yields an empty list when nothing is asked for (caller fails loud)", () => {
    expect(
      resolveFleetHosts({
        explicit: [],
        fromSshConfig: [],
        includeLocal: false,
      }),
    ).toEqual([]);
  });
});
