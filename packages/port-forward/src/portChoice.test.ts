import { describe, expect, it, vi } from "vitest";
import { type LocalPortChoice, openPreferringPort } from "./portChoice.ts";

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
        if (port === 4123) throw new Error("bind: Address already in use");
        return `opened ${port}`;
      },
    );

    expect(await openPreferringPort({ preferred: 4123, open })).toBe(
      "opened any",
    );
    expect(open.mock.calls).toEqual([[4123], ["any"]]);
  });

  it("never fails a forward merely because the matching port is busy", async () => {
    // Any bind failure counts, not just EADDRINUSE — ssh reports its own
    // wording and a relay reports node's, and neither is worth parsing.
    const open = async (port: LocalPortChoice): Promise<number> => {
      if (port !== "any")
        throw new Error("ssh exited 255: bind: Permission denied");
      return 61000;
    };

    await expect(openPreferringPort({ preferred: 80, open })).resolves.toBe(
      61000,
    );
  });

  it("reports BOTH failures when the fallback fails too", async () => {
    const open = async (port: LocalPortChoice): Promise<never> => {
      throw new Error(
        port === "any" ? "no free ports left" : "bind: Address already in use",
      );
    };

    await expect(openPreferringPort({ preferred: 4123, open })).rejects.toThrow(
      /no free ports left — and the matching local port 4123 was unavailable too: bind: Address already in use/,
    );
  });

  it("keeps the fallback failure as the error's cause", async () => {
    const fallbackFailure = new Error("no free ports left");
    const open = async (port: LocalPortChoice): Promise<never> => {
      throw port === "any" ? fallbackFailure : new Error("taken");
    };

    await expect(
      openPreferringPort({ preferred: 4123, open }),
    ).rejects.toMatchObject({ cause: fallbackFailure });
  });
});
