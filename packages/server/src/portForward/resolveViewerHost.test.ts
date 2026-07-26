/**
 * Recognising the viewer's own host — and what the resolver is allowed to
 * REMEMBER when the lookup does not answer.
 *
 * The resolver caches DNS answers for the process's life, which is right for an
 * answer: these are machines in the user's own fleet, and re-reading per request
 * would put a lookup in front of every page load. But a failure is not an
 * answer. "This name does not exist" is a stable fact worth keeping; "I could
 * not reach a resolver just now" is not, and caching it turns one blink at boot
 * into viewer recognition being off until the process restarts — with no way
 * back, because nothing ever re-asks.
 *
 * The cost of getting this wrong is quiet rather than loud: kolu simply stops
 * noticing that you are sitting at the host you are looking at, and offers a
 * forward that round-trips through a third machine to reach the one you are on.
 * It works, which is exactly why nobody would report it.
 */

import { describe, expect, it, vi } from "vitest";
import { makeViewerHostResolver } from "./resolveViewerHost.ts";

const OWN = ["100.64.0.1"];
const ZEST_ADDR = "100.64.0.9";

/** A viewer arriving from zest's address, as a connection the resolver judges. */
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
    // The load-bearing case. The first lookup fails the way a resolver fails
    // when it cannot reach a server; the second succeeds. A resolver that
    // cached the first answer would never make the second call, and would keep
    // returning "cannot tell" for the life of the process.
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
    // The ordinary case for an ssh alias, and the reason the cache is here: an
    // NXDOMAIN is a fact, so asking again on every single request would put a
    // pointless lookup in front of every page load.
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
