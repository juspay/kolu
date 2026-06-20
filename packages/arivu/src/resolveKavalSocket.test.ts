/**
 * Unit tests for `resolveKavalSocket` — which kaval the arivu daemon dials. The
 * selection POLICY (explicit wins; discover; one/many/none) and the candidate
 * labels now live in `kaval`'s `resolveRunningKavalSocket` (tested there against
 * real seeded sockets); arivu only owns RENDERING the ambiguous case as its own
 * `--kaval`-flavored error. So here we mock that seam and assert arivu's three
 * behaviours: pass the resolved socket through for explicit/one/none, and turn a
 * `many` resolution into the pasteable `--kaval` list.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("kaval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("kaval")>()),
  resolveRunningKavalSocket: h.resolve,
}));

import { resolveKavalSocket } from "./daemon.ts";

afterEach(() => vi.clearAllMocks());

describe("resolveKavalSocket", () => {
  it("passes the explicit --kaval socket through", () => {
    h.resolve.mockReturnValue({ kind: "explicit", socket: "/x/kaval.sock" });
    expect(resolveKavalSocket("/x/kaval.sock")).toBe("/x/kaval.sock");
    expect(h.resolve).toHaveBeenCalledWith("/x/kaval.sock");
  });

  it("passes the single discovered kaval socket through", () => {
    h.resolve.mockReturnValue({
      kind: "one",
      socket: "/run/user/1000/kaval-7692/pty-host.sock",
    });
    expect(resolveKavalSocket(undefined)).toBe(
      "/run/user/1000/kaval-7692/pty-host.sock",
    );
  });

  it("passes the bare default through when nothing is running", () => {
    h.resolve.mockReturnValue({
      kind: "none",
      socket: "/run/user/1000/kaval/pty-host.sock",
    });
    expect(resolveKavalSocket(undefined)).toBe(
      "/run/user/1000/kaval/pty-host.sock",
    );
  });

  it("bails with a labeled, ready-to-paste --kaval list when several kavals run", () => {
    h.resolve.mockReturnValue({
      kind: "many",
      candidates: [
        { socket: "/tmp/kaval-501/pty-host.sock", label: "standalone kaval" },
        {
          socket: "/tmp/kaval-7692-501/pty-host.sock",
          label: "kolu-server on port 7692",
        },
      ],
    });
    let msg = "";
    try {
      resolveKavalSocket(undefined);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/more than one kaval is running on this host/);
    // Each candidate is a ready-to-paste `--kaval <path>`…
    expect(msg).toContain("--kaval /tmp/kaval-7692-501/pty-host.sock");
    // …carrying the label the resolver computed.
    expect(msg).toContain("kolu-server on port 7692");
  });
});
