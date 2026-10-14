/**
 * The ssh connector hands `provisionAgent` the per-dial closure-index lookup
 * (`ProvisionOptions.published`) that the bound `resolveAgentDrv` answered
 * beside the derivation — and `null` when the resolver hands back a
 * derivation of its own (a direct `.drv`). Mocks `./agentDrv` and `./nixCopy`;
 * provisioning fails on purpose so no spawn is reached.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { directAgentDerivation, flakeAgentDerivation } from "./agentDerivation";
import {
  TEST_AGENT_SURFACE,
  TEST_BINARY_CACHE,
} from "./agentDerivation.testutil";
import { resolveAgentDrv } from "./agentDrv";
import { provisionAgent } from "./nixCopy";
import type { ConnectContext } from "./session";
import { type SshProv, sshConnector } from "./sshConnector";

vi.mock("./agentDrv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agentDrv")>()),
  resolveAgentDrv: vi.fn(),
}));
vi.mock("./nixCopy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./nixCopy")>()),
  provisionAgent: vi.fn(),
}));

const ctx: ConnectContext<SshProv> = {
  localProgress: () => {},
  remoteProgress: () => {},
  activity: () => {},
  provisioning: () => {},
  connecting: () => {},
  signal: new AbortController().signal,
  campaignEpoch: 0,
};
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-padi.drv";
const PUBLISHED = {
  index: { rawBase: "https://raw.githubusercontent.com/juspay/kolu/ca-index" },
  rev: "c891495",
  attr: "padi",
  host: { system: "x86_64-linux", nixVersion: "2.34.8" },
};

afterEach(() => vi.clearAllMocks());

const dial = async (
  resolveDrvPath: Parameters<typeof sshConnector>[0]["resolveDrvPath"],
) => {
  vi.mocked(provisionAgent).mockResolvedValue({
    ok: false,
    reason: "stop here",
    cause: "remote",
  });
  await sshConnector({
    surface: TEST_AGENT_SURFACE,
    host: "ci@croissant",
    binary: "padi",
    resolveDrvPath,
    localEnv: {},
  })(ctx).catch(() => {});
  return vi.mocked(provisionAgent).mock.calls[0]?.[0].published;
};

describe("sshConnector → provisionAgent's published lookup", () => {
  it("is what the bound resolveAgentDrv answered beside the derivation", async () => {
    const derivation = flakeAgentDerivation(
      DRV,
      "/nix/store/src#packages.x86_64-linux.padi",
      TEST_BINARY_CACHE,
    );
    vi.mocked(resolveAgentDrv).mockResolvedValue({
      derivation,
      published: PUBLISHED,
    });
    expect(
      await dial((c) => c.resolveAgentDrv("/nix/store/src", "padi")),
    ).toEqual(PUBLISHED);
  });

  it("is null for a derivation the resolver made itself", async () => {
    expect(
      await dial(async () => directAgentDerivation(DRV, TEST_BINARY_CACHE)),
    ).toBeNull();
  });
});
