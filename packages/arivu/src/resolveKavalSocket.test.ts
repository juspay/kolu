/**
 * Unit tests for `resolveKavalSocket` — which kaval the arivu daemon dials. The
 * discovery is what lets `arivu --stdio` (an `arivu-tui --host` dial) land on a
 * home-manager kolu-server's terminals with no flag: kolu namespaces its kaval
 * by listen port, so there is no fixed path to assume. `kaval`'s
 * `discoverPtyHostSockets` (which scans both the bare `kaval/` and every
 * `kaval-<port>/`) is mocked here so the four branches are pinned without a real
 * daemon.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  discover: vi.fn(),
  bareDefault: "/run/user/1000/kaval/pty-host.sock",
}));

vi.mock("kaval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("kaval")>()),
  discoverPtyHostSockets: h.discover,
  // The "nothing running" fallback path — args ignored, returns the bare default.
  getPtyHostSocketPath: () => h.bareDefault,
}));

import { resolveKavalSocket } from "./daemon.ts";

afterEach(() => vi.clearAllMocks());

describe("resolveKavalSocket", () => {
  it("returns the explicit --kaval socket verbatim, without discovery", () => {
    expect(resolveKavalSocket("/x/kaval.sock")).toBe("/x/kaval.sock");
    expect(h.discover).not.toHaveBeenCalled();
  });

  it("discovers the single running kaval — a kolu-server's port-namespaced socket", () => {
    h.discover.mockReturnValue(["/run/user/1000/kaval-7692/pty-host.sock"]);
    expect(resolveKavalSocket(undefined)).toBe(
      "/run/user/1000/kaval-7692/pty-host.sock",
    );
  });

  it("falls back to the bare default when nothing is running (for an honest connect error)", () => {
    h.discover.mockReturnValue([]);
    expect(resolveKavalSocket(undefined)).toBe(h.bareDefault);
  });

  it("bails asking for --kaval when several kavals are running", () => {
    h.discover.mockReturnValue([
      "/run/user/1000/kaval-7692/pty-host.sock",
      "/run/user/1000/kaval-8001/pty-host.sock",
    ]);
    expect(() => resolveKavalSocket(undefined)).toThrow(
      /more than one kaval daemon is running/,
    );
  });
});
