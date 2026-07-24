/**
 * Kaval owns only its consumer policy at the Surface Remote boundary. These
 * tests pin that policy without duplicating the framework's dial tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  composeSpawnEnv: vi.fn(),
}));

vi.mock("kolu-pty", () => ({ composeSpawnEnv: h.composeSpawnEnv }));

import { SURFACE_AGENT_FLAKE_REF_ENV } from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import { kavalHostDialOptions } from "./hostConnect.ts";

afterEach(() => vi.clearAllMocks());

describe("kavalHostDialOptions", () => {
  it("composes kaval's complete Surface Remote policy", () => {
    const localEnv = { PATH: "/nix/store/path" };
    h.composeSpawnEnv.mockReturnValue(localEnv);
    const env = {
      [SURFACE_AGENT_FLAKE_REF_ENV]: "/nix/store/agent-source",
    };

    const options = kavalHostDialOptions("nix@prod", env);

    expect(composeSpawnEnv).toHaveBeenCalledWith(env);
    expect(options).toEqual({
      host: "nix@prod",
      localEnv,
      binary: "kaval",
      agentFlakeRef: "/nix/store/agent-source",
      fatalPrefix: "kaval --stdio:",
    });
  });
});
