/**
 * Kaval owns only its consumer policy at the Surface Remote boundary. These
 * tests pin that policy without duplicating the framework's dial tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  composeSpawnEnv: vi.fn(),
}));

vi.mock("kolu-pty", () => ({ composeSpawnEnv: h.composeSpawnEnv }));

import { composeSpawnEnv } from "kolu-pty";
import { kavalHostDialOptions } from "./hostConnect.ts";

afterEach(() => vi.clearAllMocks());

describe("kavalHostDialOptions", () => {
  it("composes kaval's complete Surface Remote policy", () => {
    const localEnv = { PATH: "/nix/store/path" };
    h.composeSpawnEnv.mockReturnValue(localEnv);
    const env = { PATH: "/nix/store/path" };

    const options = kavalHostDialOptions("nix@prod", env);

    expect(composeSpawnEnv).toHaveBeenCalledWith(env);
    expect(options).toEqual({
      host: "nix@prod",
      localEnv,
      // Stated, not defaulted: `kaval-tui --host` deliberately provisions the
      // bare daemon, so a host kolu already provisioned with `padi-agent`
      // realises a SECOND closure when reached this way. That asymmetry is a
      // decision — pinning it here is what keeps it one.
      package: "kaval",
      binary: "kaval",
      fatalPrefix: "kaval --stdio:",
    });
  });
});
