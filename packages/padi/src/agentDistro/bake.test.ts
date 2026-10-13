/**
 * The agent-distro bake reader — what a nix wrapper hands padi about the agents
 * a terminal can be given, and the one rewrite padi makes to it (the host's own
 * state home in place of the build-time placeholder).
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_DISTRO_PROFILES_ENV,
  AGENT_PLUGIN_DIR_ENV,
  readAgentDistroBake,
} from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

const listing = (
  profiles: readonly { name: string; state: string }[],
  history = `${PLACEHOLDER}/agent-distro/history.log`,
) => JSON.stringify({ stateHomePlaceholder: PLACEHOLDER, history, profiles });

const LISTING = listing([
  { name: "vanilla", state: `${PLACEHOLDER}/agent-distro/abcvanilla` },
  { name: "juspay", state: `${PLACEHOLDER}/agent-distro/abcjuspay` },
]);

const MANIFEST = {
  default: "vanilla",
  profiles: ["vanilla", "juspay"].map((name) => ({
    name,
    dir: `/s/${name}`,
    bin: `/s/${name}/bin`,
  })),
};

const files: Record<string, string> = {
  "/l/listing.json": LISTING,
  "/l/twice.json": listing([
    { name: "vanilla", state: `${PLACEHOLDER}/agent-distro/a` },
    { name: "vanilla", state: `${PLACEHOLDER}/agent-distro/b` },
  ]),
  "/l/elsewhere.json": listing([{ name: "vanilla", state: "/root/x" }]),
  "/l/history-elsewhere.json": listing(
    [{ name: "vanilla", state: `${PLACEHOLDER}/agent-distro/a` }],
    "/root/history.log",
  ),
  "/l/empty.json": listing([]),
  "/l/not-a-listing.json": JSON.stringify({ state: "/x" }),
  "/f/floor/share/kolu/agent-distro.json": JSON.stringify(MANIFEST),
};
const read = (path: string) => {
  const text = files[path];
  if (text === undefined) throw new Error(`no such file ${path}`);
  return text;
};

const baked = (listingPath: string) => ({
  [AGENT_DISTRO_PROFILES_ENV]: listingPath,
  [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
});

describe("readAgentDistroBake", () => {
  it("reads null when unbaked — a from-source padi gives no agents", () => {
    expect(readAgentDistroBake({}, read)).toBeNull();
    expect(
      readAgentDistroBake({ [AGENT_DISTRO_PROFILES_ENV]: "" }, read),
    ).toBeNull();
  });

  it("reads the profiles in listing order, the plugin dir and the floor's manifest", () => {
    const bake = readAgentDistroBake(
      { ...baked("/l/listing.json"), [AGENT_DISTRO_BUNDLE_ENV]: "/f/floor" },
      read,
    );
    expect(bake?.floor).toEqual(MANIFEST);
    expect(bake?.plugins).toBe("/p/plugin");
    expect([...(bake?.profiles.keys() ?? [])]).toEqual(["vanilla", "juspay"]);
  });

  it("a baked floor without its manifest is a broken build: it throws", () => {
    expect(() =>
      readAgentDistroBake(
        { ...baked("/l/listing.json"), [AGENT_DISTRO_BUNDLE_ENV]: "/no/floor" },
        read,
      ),
    ).toThrow();
  });

  it("a remote bake has no floor", () => {
    expect(
      readAgentDistroBake(baked("/l/listing.json"), read)?.floor,
    ).toBeUndefined();
  });

  it("throws on a half bake (listing without the plugin dir)", () => {
    expect(() =>
      readAgentDistroBake(
        { [AGENT_DISTRO_PROFILES_ENV]: "/l/listing.json" },
        read,
      ),
    ).toThrow(/half-baked/);
  });

  it("throws on a listing that does not parse as one, or names no profile", () => {
    expect(() =>
      readAgentDistroBake(baked("/l/not-a-listing.json"), read),
    ).toThrow();
    expect(() => readAgentDistroBake(baked("/l/empty.json"), read)).toThrow();
  });

  it("throws on a listing that names a profile twice", () => {
    expect(() => readAgentDistroBake(baked("/l/twice.json"), read)).toThrow(
      /twice/,
    );
  });
});

describe("each profile's state, made concrete once, at read", () => {
  const bake = readAgentDistroBake(
    baked("/l/listing.json"),
    read,
    "/home/u/.local/state",
  );
  const vanilla = bake?.profiles.get("vanilla");
  if (!bake || !vanilla) throw new Error("fixture bake did not read");

  it("puts the host's state home where the placeholder was", () => {
    expect(vanilla).toEqual({
      name: "vanilla",
      stateDir: "/home/u/.local/state/agent-distro/abcvanilla",
      historyFile: "/home/u/.local/state/agent-distro/history.log",
    });
    expect(bake.profiles.get("juspay")?.stateDir).toBe(
      "/home/u/.local/state/agent-distro/abcjuspay",
    );
  });

  it("refuses, at read, a state dir or history log not under the placeholder", () => {
    expect(() =>
      readAgentDistroBake(baked("/l/elsewhere.json"), read, "/h"),
    ).toThrow(/not under/);
    expect(() =>
      readAgentDistroBake(baked("/l/history-elsewhere.json"), read, "/h"),
    ).toThrow(/not under/);
  });
});
