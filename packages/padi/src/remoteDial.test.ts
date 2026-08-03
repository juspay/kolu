import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PADI_SURFACE_VERSION } from "./surface.ts";

const h = vi.hoisted(() => ({ dialAgentOnce: vi.fn() }));

vi.mock("@kolu/surface-remote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-remote")>();
  return { ...actual, dialAgentOnce: h.dialAgentOnce };
});

import { dialAgentOnce } from "@kolu/surface-remote";
import { dialPadiViaHost } from "./dial.ts";

/** The face `dialAgentOnce` hands its probe. `sshConnector` builds ONE face from
 *  ONE surface and never hands the link's dispatch back, so padi's remote gate
 *  reads its own `identity` CELL rather than the frozen control core — the SAME
 *  fact, seeded at boot from the same source constants `hello` echoes. A cell read
 *  is a lazy `Stream` now, so the fake answers with one. */
function fakeCombinedClient(surfaceVersion: string) {
  return {
    surface: {
      identity: {
        get: () => Stream.make({ surfaceVersion }),
      },
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("dialPadiViaHost", () => {
  it("owns padi's remote transport policy in one place", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    await dialPadiViaHost("nix@prod");

    expect(dialAgentOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "nix@prod",
        binary: "padi",
        fatalPrefix: "padi --stdio:",
      }),
    );
    const opts = vi.mocked(dialAgentOnce).mock.calls[0]?.[0];
    expect(opts?.extraArgs).toBeUndefined();
  });

  it("gates the remote padi contract through the frozen hello", async () => {
    h.dialAgentOnce.mockResolvedValue({
      client: fakeCombinedClient(PADI_SURFACE_VERSION),
      dispose: () => {},
    });
    await dialPadiViaHost("nix@prod");

    const probe = vi.mocked(dialAgentOnce).mock.calls[0]?.[0].probe;
    if (probe === undefined) throw new Error("padi dial omitted its gate");

    await expect(
      Effect.runPromise(
        probe(fakeCombinedClient(PADI_SURFACE_VERSION) as never),
      ),
    ).resolves.toBeUndefined();
    await expect(
      Effect.runPromise(probe(fakeCombinedClient("999.0") as never)),
    ).rejects.toThrow(/contract skew/);
  });
});
