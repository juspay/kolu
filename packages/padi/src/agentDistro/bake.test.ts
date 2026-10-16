/**
 * The agent-distro bake reader — what a nix wrapper hands padi about the agents
 * a terminal can be given, and the one rewrite padi makes to it (the host's own
 * state home in place of the build-time placeholder).
 */

import { readFrom } from "@kolu/agent-distro/testing";
import { describe, expect, it } from "vitest";
import {
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_DISTRO_STATE_ENV,
  AGENT_PLUGIN_DIR_ENV,
  readAgentDistroBake,
} from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

const hostState = (over: Partial<Record<string, string>> = {}) =>
  JSON.stringify({
    stateHomePlaceholder: PLACEHOLDER,
    state: `${PLACEHOLDER}/agent-distro/abcpackage`,
    history: `${PLACEHOLDER}/agent-distro/history.log`,
    landed: `${PLACEHOLDER}/kolu/agent-distro-landed.json`,
    ...over,
  });

const MANIFEST = { dir: "/s/package", bin: "/s/package/bin" };

const read = readFrom({
  "/l/state.json": hostState(),
  "/l/state-elsewhere.json": hostState({ state: "/root/x" }),
  "/l/history-elsewhere.json": hostState({ history: "/root/history.log" }),
  "/l/landed-elsewhere.json": hostState({ landed: "/root/landed.json" }),
  "/l/not-a-state.json": JSON.stringify({ state: "/x" }),
  "/f/floor/share/kolu/agent-distro.json": JSON.stringify(MANIFEST),
});

const baked = (statePath: string) => ({
  [AGENT_DISTRO_STATE_ENV]: statePath,
  [AGENT_PLUGIN_DIR_ENV]: "/p/plugin",
});

describe("readAgentDistroBake", () => {
  it("reads null when unbaked — a from-source padi gives no agents", () => {
    expect(readAgentDistroBake({}, read)).toBeNull();
    expect(
      readAgentDistroBake({ [AGENT_DISTRO_STATE_ENV]: "" }, read),
    ).toBeNull();
  });

  it("reads the plugin dir and the floor's manifest", () => {
    const bake = readAgentDistroBake(
      { ...baked("/l/state.json"), [AGENT_DISTRO_BUNDLE_ENV]: "/f/floor" },
      read,
    );
    expect(bake?.floor).toEqual(MANIFEST);
    expect(bake?.plugins).toBe("/p/plugin");
  });

  it("a baked floor without its manifest is a broken build: it throws", () => {
    expect(() =>
      readAgentDistroBake(
        { ...baked("/l/state.json"), [AGENT_DISTRO_BUNDLE_ENV]: "/no/floor" },
        read,
      ),
    ).toThrow();
  });

  it("a remote bake has no floor", () => {
    expect(
      readAgentDistroBake(baked("/l/state.json"), read)?.floor,
    ).toBeUndefined();
  });

  it("throws on a half bake (host state without the plugin dir)", () => {
    expect(() =>
      readAgentDistroBake({ [AGENT_DISTRO_STATE_ENV]: "/l/state.json" }, read),
    ).toThrow(/half-baked/);
  });

  it("throws on a host state that does not parse as one", () => {
    expect(() =>
      readAgentDistroBake(baked("/l/not-a-state.json"), read),
    ).toThrow();
  });
});

describe("the host state, made concrete once, at read", () => {
  it("puts the host's state home where the placeholder was", () => {
    expect(
      readAgentDistroBake(
        baked("/l/state.json"),
        read,
        "/home/u/.local/state",
        "/home/u",
      ),
    ).toEqual({
      floor: undefined,
      plugins: "/p/plugin",
      stateDir: "/home/u/.local/state/agent-distro/abcpackage",
      historyFile: "/home/u/.local/state/agent-distro/history.log",
      landedFile: "/home/u/.local/state/kolu/agent-distro-landed.json",
      gcRootsDir: "/home/u/.local/state/kolu/agent-distro/gcroots",
    });
  });

  it("refuses, at read, a state dir, history log or landed record not under the placeholder", () => {
    for (const path of [
      "/l/state-elsewhere.json",
      "/l/history-elsewhere.json",
      "/l/landed-elsewhere.json",
    ])
      expect(() => readAgentDistroBake(baked(path), read, "/h")).toThrow(
        /not under/,
      );
  });
});
