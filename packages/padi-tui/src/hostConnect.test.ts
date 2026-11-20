import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dialPadiViaHost: vi.fn() }));

vi.mock("@kolu/padi/remote-dial", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kolu/padi/remote-dial")>();
  return { ...actual, dialPadiViaHost: h.dialPadiViaHost };
});

import { connectPadiTuiViaHost } from "./hostConnect.ts";

function fakePadiFace() {
  return { surface: { terminals: { keys: () => undefined } } };
}

afterEach(() => vi.clearAllMocks());

describe("connectPadiTuiViaHost", () => {
  it("passes padi's shared remote dial face through UNWRAPPED", async () => {
    const client = fakePadiFace();
    h.dialPadiViaHost.mockResolvedValue({ client, dispose: () => {} });

    const connection = await Effect.runPromise(
      Effect.scoped(
        Effect.map(connectPadiTuiViaHost("nix@prod"), (conn) => ({ ...conn })),
      ),
    );

    expect(h.dialPadiViaHost).toHaveBeenCalledWith("nix@prod");
    expect(connection.client).toBe(client);
    expect(connection.localCwd).toBeUndefined();
  });

  it("disposes the shared dial when the caller's SCOPE closes", async () => {
    const dispose = vi.fn();
    h.dialPadiViaHost.mockResolvedValue({ client: fakePadiFace(), dispose });

    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(connectPadiTuiViaHost("nix@prod"), () => Effect.void),
      ),
    );

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does NOT dispose while the scope is still open", async () => {
    const dispose = vi.fn();
    h.dialPadiViaHost.mockResolvedValue({ client: fakePadiFace(), dispose });

    await Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(connectPadiTuiViaHost("nix@prod"), () =>
          Effect.sync(() => {
            expect(dispose).not.toHaveBeenCalled();
          }),
        ),
      ),
    );
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
