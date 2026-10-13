/** The bundle and state layout kolu relies on. */

import { describe, expect, it } from "vitest";
import {
  agentBinDir,
  agentBundleShortHash,
  concreteStatePath,
  currentLink,
} from "./bundle.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

describe("layout", () => {
  it("names a bundle's bin and a state dir's current", () => {
    expect(agentBinDir("/nix/store/x-vanilla")).toBe(
      "/nix/store/x-vanilla/bin",
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

describe("concreteStatePath", () => {
  it("puts the host's state home where the placeholder was", () => {
    expect(
      concreteStatePath(
        `${PLACEHOLDER}/agent-distro/abc`,
        PLACEHOLDER,
        "/home/u/.local/state",
      ),
    ).toBe("/home/u/.local/state/agent-distro/abc");
  });

  it("refuses a path that is not under the placeholder", () => {
    expect(() =>
      concreteStatePath("/root/x", PLACEHOLDER, "/home/u/.local/state"),
    ).toThrow(/not under/);
  });
});
