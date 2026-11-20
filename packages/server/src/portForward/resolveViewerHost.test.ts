import { describe, expect, it, vi } from "vitest";
import {
  makeViewerHostResolver,
  sshTargetHostname,
} from "./resolveViewerHost.ts";

const OWN = ["100.64.0.1"];
const ZEST_ADDR = "100.64.0.9";

const fromZest = { peerAddress: ZEST_ADDR, forwardedFor: undefined };

function transient(code: string): Error {
  return Object.assign(new Error(`lookup failed: ${code}`), { code });
}

describe("makeViewerHostResolver — what a failed lookup may cache", () => {
  it("recognises the viewer once the name resolves", async () => {
    const resolve = vi.fn(async () => [ZEST_ADDR]);
    const viewerHost = makeViewerHostResolver({
      hosts: () => ["remote:zest"],
      resolve,
      own: () => OWN,
    });
    expect(await viewerHost(fromZest)).toEqual({
      kind: "remote",
      target: "zest",
    });
  });

  it("re-asks after a TRANSIENT failure instead of giving up for good", async () => {
    const resolve = vi
      .fn<(hostname: string) => Promise<readonly string[]>>()
      .mockRejectedValueOnce(transient("EAI_AGAIN"))
      .mockResolvedValue([ZEST_ADDR]);
    const viewerHost = makeViewerHostResolver({
      hosts: () => ["remote:zest"],
      resolve,
      own: () => OWN,
    });

    expect(await viewerHost(fromZest)).toBeNull();
    expect(await viewerHost(fromZest)).toEqual({
      kind: "remote",
      target: "zest",
    });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does NOT re-ask a name that definitively does not exist", async () => {
    const resolve = vi
      .fn<(hostname: string) => Promise<readonly string[]>>()
      .mockRejectedValue(
        Object.assign(new Error("getaddrinfo ENOTFOUND"), {
          code: "ENOTFOUND",
        }),
      );
    const viewerHost = makeViewerHostResolver({
      hosts: () => ["remote:zest"],
      resolve,
      own: () => OWN,
    });

    expect(await viewerHost(fromZest)).toBeNull();
    expect(await viewerHost(fromZest)).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe("sshTargetHostname", () => {
  it("drops the user, which no resolver takes", () => {
    expect(sshTargetHostname("srid@zest")).toBe("zest");
    expect(sshTargetHostname("zest")).toBe("zest");
  });

  it("splits on the LAST @, so a user containing one cannot eat the host", () => {
    expect(sshTargetHostname("srid@example.com@zest")).toBe("zest");
  });
});
