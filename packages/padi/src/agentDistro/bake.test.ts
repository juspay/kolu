/**
 * The agent-distro bake reader — what a nix wrapper hands padi about the agents
 * a terminal can be given, and the one rewrite padi makes to it (the host's own
 * state home in place of the build-time placeholder).
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_DISTRO_UPDATER_ENV,
  AGENT_PLUGIN_DIR_ENV,
  hostUpdaterConfig,
  readAgentDistroBake,
} from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

const LISTING = JSON.stringify({
  stateHomePlaceholder: PLACEHOLDER,
  profiles: [
    {
      name: "vanilla",
      command: ["/n/node", "/t/update.ts"],
      config: "/c/v.json",
    },
    {
      name: "juspay",
      command: ["/n/node", "/t/update.ts"],
      config: "/c/j.json",
    },
  ],
});

const config = (profile: string) =>
  JSON.stringify({
    profile,
    flake: "github:juspay/agent-distro",
    state: `${PLACEHOLDER}/agent-distro/abc${profile}`,
    history: `${PLACEHOLDER}/agent-distro/history.log`,
    nix: "nix",
    substituters: {},
    periodSeconds: 21600,
    offsetSeconds: 7200,
  });

const files: Record<string, string> = {
  "/l/listing.json": LISTING,
  "/c/v.json": config("vanilla"),
  "/c/j.json": config("juspay"),
};
const read = (path: string) => {
  const text = files[path];
  if (text === undefined) throw new Error(`no such file ${path}`);
  return text;
};

describe("readAgentDistroBake", () => {
  it("reads null when unbaked — a from-source padi gives no agents", () => {
    expect(readAgentDistroBake({}, read)).toBeNull();
    expect(
      readAgentDistroBake({ [AGENT_DISTRO_UPDATER_ENV]: "" }, read),
    ).toBeNull();
  });

  it("reads the profiles in listing order, the plugin dir and the floor", () => {
    const bake = readAgentDistroBake(
      {
        [AGENT_DISTRO_UPDATER_ENV]: "/l/listing.json",
        [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
        [AGENT_DISTRO_BUNDLE_ENV]: "/f/floor",
      },
      read,
    );
    expect(bake?.floor).toBe("/f/floor");
    expect(bake?.plugins).toBe("/p/plugin");
    expect([...(bake?.profiles.keys() ?? [])]).toEqual(["vanilla", "juspay"]);
  });

  it("a remote bake has no floor", () => {
    const bake = readAgentDistroBake(
      {
        [AGENT_DISTRO_UPDATER_ENV]: "/l/listing.json",
        [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
      },
      read,
    );
    expect(bake?.floor).toBeUndefined();
  });

  it("throws on a half bake (listing without the plugin dir)", () => {
    expect(() =>
      readAgentDistroBake(
        { [AGENT_DISTRO_UPDATER_ENV]: "/l/listing.json" },
        read,
      ),
    ).toThrow(/half-baked/);
  });

  it("throws on a listing that does not parse as one", () => {
    expect(() =>
      readAgentDistroBake(
        {
          [AGENT_DISTRO_UPDATER_ENV]: "/c/v.json",
          [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
        },
        read,
      ),
    ).toThrow();
  });
});

describe("hostUpdaterConfig", () => {
  const bake = readAgentDistroBake(
    {
      [AGENT_DISTRO_UPDATER_ENV]: "/l/listing.json",
      [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
    },
    read,
  );
  const vanilla = bake?.profiles.get("vanilla");
  if (!bake || !vanilla) throw new Error("fixture bake did not read");

  it("puts the host's state home where the placeholder was, in state and history", () => {
    const { text, stateDir } = hostUpdaterConfig(
      bake,
      vanilla,
      "/home/u/.local/state",
    );
    expect(stateDir).toBe("/home/u/.local/state/agent-distro/abcvanilla");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.state).toBe(stateDir);
    expect(parsed.history).toBe(
      "/home/u/.local/state/agent-distro/history.log",
    );
    // Everything else is the updater's, passed through untouched.
    expect(parsed.flake).toBe("github:juspay/agent-distro");
    expect(parsed.periodSeconds).toBe(21600);
  });

  it("refuses a config whose state is not under the placeholder", () => {
    expect(() =>
      hostUpdaterConfig(
        bake,
        {
          ...vanilla,
          configText: JSON.stringify({ state: "/root/x", history: "/root/h" }),
        },
        "/home/u/.local/state",
      ),
    ).toThrow(/not under/);
  });
});
