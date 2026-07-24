import { describe, expect, it, vi } from "vitest";
import {
  type LocalPortChoice,
  openPreferringPort,
  PortUnavailableError,
} from "./portChoice.ts";

describe("openPreferringPort", () => {
  it("takes the target's own port number when it is free", async () => {
    const open = vi.fn<(port: LocalPortChoice) => Promise<string>>(
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

  it("falls back to any free port when that number is taken", async () => {
    const open = vi.fn<(port: LocalPortChoice) => Promise<string>>(
      async (port) => {
        if (port === 4123) {
          throw new PortUnavailableError(4123, "bind: Address already in use");
        }
        return `opened ${port}`;
      },
    );

    expect(await openPreferringPort({ preferred: 4123, open })).toBe(
      "opened any",
    );
    expect(open.mock.calls).toEqual([[4123], ["any"]]);
  });

  it("never fails a forward merely because the matching port is busy", async () => {
    const open = async (port: LocalPortChoice): Promise<number> => {
      if (port !== "any") {
        throw new PortUnavailableError(80, "bind: Permission denied");
      }
      return 61000;
    };

    await expect(openPreferringPort({ preferred: 80, open })).resolves.toBe(
      61000,
    );
  });

  it("does NOT retry a failure that has nothing to do with the port", async () => {
    // Retrying a refused host on a different local port would fail identically
    // and then blame the port — the user would go hunting for a port conflict
    // that never existed.
    const open = vi.fn<(port: LocalPortChoice) => Promise<never>>(async () => {
      throw new Error("ssh exited 255: Host key verification failed");
    });

    await expect(openPreferringPort({ preferred: 4123, open })).rejects.toThrow(
      /Host key verification failed/,
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(4123);
  });

  it("reports BOTH failures when the fallback fails too", async () => {
    const open = async (port: LocalPortChoice): Promise<never> => {
      if (port === "any") throw new Error("no free ports left");
      throw new PortUnavailableError(4123, "bind: Address already in use");
    };

    await expect(openPreferringPort({ preferred: 4123, open })).rejects.toThrow(
      /no free ports left — after falling back from port-forward: local port 4123 is unavailable/,
    );
  });

  it("keeps the fallback failure as the error's cause", async () => {
    const fallbackFailure = new Error("no free ports left");
    const open = async (port: LocalPortChoice): Promise<never> => {
      throw port === "any"
        ? fallbackFailure
        : new PortUnavailableError(4123, "taken");
    };

    await expect(
      openPreferringPort({ preferred: 4123, open }),
    ).rejects.toMatchObject({ cause: fallbackFailure });
  });
});
