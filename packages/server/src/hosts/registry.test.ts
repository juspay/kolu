/**
 * Host registry — config parsing + validation (pure, hermetic).
 *
 * The static-config axis must be strict and fail clearly: a malformed
 * KOLU_HOSTS_JSON / KOLU_WATCHER_AGENT_DRVS_JSON is a deploy error, and
 * surfacing it as a clean throw at endpoint-construction (not a misclassified
 * "network" fault deep in the reconnect loop) is the whole point. No ssh, no
 * resolveSystem here — only env parsing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { hostConfigFor, listConfiguredHosts } from "./registry.ts";

afterEach(() => vi.unstubAllEnvs());

describe("listConfiguredHosts", () => {
  it("is empty when KOLU_HOSTS_JSON is unset (the pre-P3 local-only world)", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", "");
    expect(listConfiguredHosts()).toEqual([]);
  });

  it("parses a { hostId: sshTarget } map", () => {
    vi.stubEnv(
      "KOLU_HOSTS_JSON",
      JSON.stringify({ prod: "nix@prod.example", builder: "builder" }),
    );
    expect(listConfiguredHosts()).toEqual([
      { hostId: "prod", host: "nix@prod.example" },
      { hostId: "builder", host: "builder" },
    ]);
  });

  it("throws on malformed JSON", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", "{not json");
    expect(() => listConfiguredHosts()).toThrow(/KOLU_HOSTS_JSON/);
  });

  it("throws when the map is an array (not an object of strings)", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", JSON.stringify(["prod"]));
    expect(() => listConfiguredHosts()).toThrow(/object of string values/);
  });

  it("throws when a value is not a string", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", JSON.stringify({ prod: 7 }));
    expect(() => listConfiguredHosts()).toThrow(/object of string values/);
  });
});

describe("hostConfigFor", () => {
  it("returns undefined for an empty / local hostId (not a remote dial)", () => {
    expect(hostConfigFor("")).toBeUndefined();
    expect(hostConfigFor("local")).toBeUndefined();
  });

  it("dials an unconfigured hostId AS the ssh target verbatim (ad-hoc hosts)", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", JSON.stringify({ prod: "nix@prod" }));
    expect(hostConfigFor("nix@adhoc-box")?.host).toBe("nix@adhoc-box");
  });

  it("returns the ssh target + a deferred resolveDrvPath for a configured host", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", JSON.stringify({ prod: "nix@prod" }));
    vi.stubEnv(
      "KOLU_WATCHER_AGENT_DRVS_JSON",
      JSON.stringify({ "x86_64-linux": "/nix/store/abc-kolu-watcher.drv" }),
    );
    const config = hostConfigFor("prod");
    expect(config?.host).toBe("nix@prod");
    expect(typeof config?.resolveDrvPath).toBe("function");
  });

  it("validates the drv map eagerly (a malformed map throws at config build)", () => {
    vi.stubEnv("KOLU_HOSTS_JSON", JSON.stringify({ prod: "nix@prod" }));
    vi.stubEnv("KOLU_WATCHER_AGENT_DRVS_JSON", "{bad");
    expect(() => hostConfigFor("prod")).toThrow(/KOLU_WATCHER_AGENT_DRVS_JSON/);
  });
});
