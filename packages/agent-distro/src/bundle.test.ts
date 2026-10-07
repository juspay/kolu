/** The bundle and state layout kolu relies on. */

import { describe, expect, it } from "vitest";
import {
  agentBinDir,
  agentBundleShortHash,
  concreteUpdaterConfig,
  currentLink,
  floorPicker,
  floorProfileDir,
} from "./bundle.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

describe("layout", () => {
  it("names a bundle's bin, the floor's picker and profile dirs, and a state dir's current", () => {
    expect(agentBinDir("/nix/store/x-vanilla")).toBe(
      "/nix/store/x-vanilla/bin",
    );
    expect(floorPicker("/nix/store/f")).toBe("/nix/store/f/bin/agent-distro");
    expect(floorProfileDir("/nix/store/f", "juspay")).toBe(
      "/nix/store/f/profiles/juspay",
    );
    expect(currentLink("/s/agent-distro/abc")).toBe(
      "/s/agent-distro/abc/current",
    );
  });

  it("shortens a store path to the first 8 characters of its hash", () => {
    expect(
      agentBundleShortHash(
        "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla",
      ),
    ).toBe("nd11nx5f");
  });
});

describe("concreteUpdaterConfig", () => {
  const config = JSON.stringify({
    profile: "vanilla",
    flake: "github:juspay/agent-distro",
    state: `${PLACEHOLDER}/agent-distro/abc`,
    history: `${PLACEHOLDER}/agent-distro/history.log`,
    periodSeconds: 21600,
  });

  it("puts the host's state home where the placeholder was, and nothing else", () => {
    const { text, stateDir } = concreteUpdaterConfig(
      config,
      PLACEHOLDER,
      "/home/u/.local/state",
    );
    expect(stateDir).toBe("/home/u/.local/state/agent-distro/abc");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.history).toBe(
      "/home/u/.local/state/agent-distro/history.log",
    );
    expect(parsed.flake).toBe("github:juspay/agent-distro");
    expect(parsed.periodSeconds).toBe(21600);
  });

  it("refuses a config whose state is not under the placeholder", () => {
    expect(() =>
      concreteUpdaterConfig(
        JSON.stringify({ state: "/root/x", history: "/root/h" }),
        PLACEHOLDER,
        "/home/u/.local/state",
      ),
    ).toThrow(/not under/);
  });
});
