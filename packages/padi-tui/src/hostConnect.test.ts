/**
 * `--host`'s wiring: padi-tui reaches a remote padi ONLY through the shared
 * `@kolu/padi/dial` kit, and hands its face and disposal straight into the
 * transport-blind `Connection` every verb is written against.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dialPadiViaHost: vi.fn() }));

vi.mock("@kolu/padi/dial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/padi/dial")>();
  return { ...actual, dialPadiViaHost: h.dialPadiViaHost };
});

import { connectPadiTuiViaHost } from "./hostConnect.ts";

/** What the shared dial hands back now: ONE face, already addressing
 *  `surface/padi/*` (the ssh link is opened with padi's SIBLING surface, so the
 *  tags are minted scoped). There is no combined client with a `.surface.padi`
 *  namespace left to narrow — that nesting was the oRPC contract's, and the
 *  Effect wire namespace is flat. */
function fakePadiFace() {
  return { surface: { terminals: { keys: () => undefined } } };
}

afterEach(() => vi.clearAllMocks());

describe("connectPadiTuiViaHost", () => {
  it("passes padi's shared remote dial face through UNWRAPPED", async () => {
    const client = fakePadiFace();
    h.dialPadiViaHost.mockResolvedValue({ client, dispose: () => {} });

    const connection = await connectPadiTuiViaHost("nix@prod");

    expect(h.dialPadiViaHost).toHaveBeenCalledWith("nix@prod");
    // Identity, not shape: the dial already scoped the face, so re-wrapping it
    // here would be a second authority on where padi's tags live.
    expect(connection.client).toBe(client);
    // A remote padi runs elsewhere, so the local cwd is not a path there.
    expect(connection.localCwd).toBeUndefined();
  });

  it("threads the shared dial's disposal through", async () => {
    const dispose = vi.fn();
    h.dialPadiViaHost.mockResolvedValue({ client: fakePadiFace(), dispose });

    const connection = await connectPadiTuiViaHost("nix@prod");
    connection.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
