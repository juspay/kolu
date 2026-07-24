import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dialPadiViaHost: vi.fn() }));

vi.mock("@kolu/padi/dial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/padi/dial")>();
  return { ...actual, dialPadiViaHost: h.dialPadiViaHost };
});

import { connectPadiTuiViaHost } from "./hostConnect.ts";

function fakeCombinedClient() {
  return {
    surface: {
      padi: { marker: "padi-sibling" },
      control: {
        core: {
          hello: async () => ({ surfaceVersion: PADI_SURFACE_VERSION }),
        },
      },
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe("connectPadiTuiViaHost", () => {
  it("uses padi's shared remote dial and scopes its combined client", async () => {
    h.dialPadiViaHost.mockResolvedValue({
      client: fakeCombinedClient(),
      dispose: () => {},
    });

    const connection = await connectPadiTuiViaHost("nix@prod");

    expect(h.dialPadiViaHost).toHaveBeenCalledWith("nix@prod");
    expect(connection.client.surface).toEqual({ marker: "padi-sibling" });
    expect(connection.localCwd).toBeUndefined();
  });

  it("threads the shared dial's disposal through", async () => {
    const dispose = vi.fn();
    h.dialPadiViaHost.mockResolvedValue({
      client: fakeCombinedClient(),
      dispose,
    });

    const connection = await connectPadiTuiViaHost("nix@prod");
    connection.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
