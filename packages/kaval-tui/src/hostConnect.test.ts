import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  composeSpawnEnv: vi.fn(),
}));

vi.mock("kolu-pty", () => ({ composeSpawnEnv: h.composeSpawnEnv }));

import { ptyHostSurface } from "kaval";
import { composeSpawnEnv } from "kolu-pty";
import { kavalHostDialOptions } from "./hostConnect.ts";

afterEach(() => vi.clearAllMocks());

describe("kavalHostDialOptions", () => {
  it("composes kaval's complete Surface Remote policy", () => {
    const localEnv = { PATH: "/nix/store/path" };
    h.composeSpawnEnv.mockReturnValue(localEnv);
    const env = { PATH: "/nix/store/path" };

    const { surface, ...policy } = kavalHostDialOptions("nix@prod", env);

    expect(composeSpawnEnv).toHaveBeenCalledWith(env);
    expect(surface).toBe(ptyHostSurface);
    expect(policy).toEqual({
      host: "nix@prod",
      localEnv,
      package: "kaval",
      binary: "kaval",
      fatalPrefix: "kaval --stdio:",
    });
  });
});
