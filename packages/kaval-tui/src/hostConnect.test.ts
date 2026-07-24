/**
 * Kaval owns only its consumer policy at the Surface Remote boundary. These
 * tests pin that policy without duplicating the framework's dial tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  composeSpawnEnv: vi.fn(),
  dialAgentOnce: vi.fn(),
}));

vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
  return { ...actual, dialAgentOnce: h.dialAgentOnce };
});
vi.mock("kolu-pty", () => ({ composeSpawnEnv: h.composeSpawnEnv }));

import {
  dialAgentOnce,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import type { Connection } from "./connect.ts";
import { connectPtyHostViaHost } from "./hostConnect.ts";

afterEach(() => vi.clearAllMocks());

describe("connectPtyHostViaHost", () => {
  it("passes kaval's complete policy to Surface Remote", async () => {
    const localEnv = { PATH: "/nix/store/path" };
    const connection = {
      client: {},
      dispose: vi.fn(),
    } as unknown as Connection;
    h.composeSpawnEnv.mockReturnValue(localEnv);
    h.dialAgentOnce.mockResolvedValue(connection);

    await expect(connectPtyHostViaHost("nix@prod")).resolves.toBe(connection);

    expect(composeSpawnEnv).toHaveBeenCalledWith(process.env);
    expect(dialAgentOnce).toHaveBeenCalledWith({
      host: "nix@prod",
      localEnv,
      binary: "kaval",
      agentFlakeRef: process.env[SURFACE_AGENT_FLAKE_REF_ENV],
      fatalPrefix: "kaval --stdio:",
    });
  });
});
