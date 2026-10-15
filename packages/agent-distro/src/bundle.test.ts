/** The package and state layout kolu relies on. */

import { describe, expect, it } from "vitest";
import {
  agentBinDir,
  agentBundleShortHash,
  concreteStatePath,
  currentLink,
  lastSuccessFile,
  versionsFile,
} from "./bundle.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

describe("layout", () => {
  it("names a package's bin and versions, and a state dir's current and last-success", () => {
    expect(agentBinDir("/nix/store/x-agent-distro")).toBe(
      "/nix/store/x-agent-distro/bin",
    );
    expect(versionsFile("/nix/store/x-agent-distro")).toBe(
      "/nix/store/x-agent-distro/share/agent-distro/versions",
    );
    expect(currentLink("/s/agent-distro/abc")).toBe(
      "/s/agent-distro/abc/current",
    );
    expect(lastSuccessFile("/s/agent-distro/abc")).toBe(
      "/s/agent-distro/abc/last-success",
    );
  });

  it("shortens a store path to the first 8 characters of its hash", () => {
    expect(
      agentBundleShortHash(
        "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro",
      ),
    ).toBe("nd11nx5f");
  });

  it("shortens a path that is no store path to its last segment, cut to 8", () => {
    expect(agentBundleShortHash("/tmp/fixture/agents-package/")).toBe(
      "agents-p",
    );
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
