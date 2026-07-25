import { beforeEach, describe, expect, it, vi } from "vitest";
import { canBindLocally } from "./freePort.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";

// The kernel questions are the ones this module now OWNS, so they are what the
// test drives: "is the preferred number free here?" and "give me any free one".
vi.mock("./freePort.ts", () => ({
  canBindLocally: vi.fn(async () => true),
  pickFreePort: vi.fn(async () => 61000),
}));

beforeEach(() => {
  vi.mocked(canBindLocally).mockResolvedValue(true);
});

describe("openPreferringPort", () => {
  it("takes the target's own port number when it is free", async () => {
    const open = vi.fn<(port: number) => Promise<string>>(
      async (port) => `opened ${port}`,
    );

    expect(await openPreferringPort({ preferred: 4123, open })).toBe(
      "opened 4123",
    );
    // No second attempt: the preferred number worked, so the kernel is never
    // asked to pick.
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(4123);
  });

  it("never even tries a number something local already answers on", async () => {
    // A listener beside an existing one (SO_REUSEADDR) would make the number
    // mean two different servers depending on the address dialled.
    vi.mocked(canBindLocally).mockResolvedValue(false);
    const open = vi.fn<(port: number) => Promise<string>>(
      async (port) => `opened ${port}`,
    );

    expect(await openPreferringPort({ preferred: 4123, open })).toBe(
      "opened 61000",
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(61000);
  });

  it("falls back to any free port when the bind loses the race", async () => {
    const open = vi.fn<(port: number) => Promise<string>>(async (port) => {
      if (port === 4123) {
        throw new PortUnavailableError(4123, "bind: Address already in use");
      }
      return `opened ${port}`;
    });

    expect(await openPreferringPort({ preferred: 4123, open })).toBe(
      "opened 61000",
    );
    expect(open.mock.calls).toEqual([[4123], [61000]]);
  });

  it("never fails a forward merely because the matching port is busy", async () => {
    const open = async (port: number): Promise<number> => {
      if (port === 80) {
        throw new PortUnavailableError(80, "bind: Permission denied");
      }
      return port;
    };

    await expect(openPreferringPort({ preferred: 80, open })).resolves.toBe(
      61000,
    );
  });

  it("does NOT retry a failure that has nothing to do with the port", async () => {
    // Retrying a refused host on a different local port would fail identically
    // and then blame the port — the user would go hunting for a port conflict
    // that never existed.
    const open = vi.fn<(port: number) => Promise<never>>(async () => {
      throw new Error("ssh exited 255: Host key verification failed");
    });

    await expect(openPreferringPort({ preferred: 4123, open })).rejects.toThrow(
      /Host key verification failed/,
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(4123);
  });

  it("reports BOTH failures when the fallback fails too", async () => {
    const open = async (port: number): Promise<never> => {
      if (port === 61000) throw new Error("no free ports left");
      throw new PortUnavailableError(4123, "bind: Address already in use");
    };

    await expect(openPreferringPort({ preferred: 4123, open })).rejects.toThrow(
      /no free ports left — after falling back from port-forward: local port 4123 is unavailable/,
    );
  });

  it("keeps the fallback failure as the error's cause", async () => {
    const fallbackFailure = new Error("no free ports left");
    const open = async (port: number): Promise<never> => {
      throw port === 61000
        ? fallbackFailure
        : new PortUnavailableError(4123, "taken");
    };

    await expect(
      openPreferringPort({ preferred: 4123, open }),
    ).rejects.toMatchObject({ cause: fallbackFailure });
  });
});
