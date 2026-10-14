// @vitest-environment happy-dom
/**
 * A lane's way out to odu web — the address, and the fact that it is not always
 * an address yet.
 *
 * Two decisions are executed here, because both are pure and both are easy to
 * get plausible-but-wrong:
 *
 *   - WHICH page a lane points at: its own log, or — for a lane that never
 *     started — the run. odu marks "no attempt yet" with an EMPTY log key rather
 *     than a fabricated attempt 1, and a link built from a guessed attempt would
 *     open a `log.read` that refuses.
 *   - WHETHER the browser can reach the daemon at all. odu binds loopback, so a
 *     browser that is not ON that machine needs a door — and the door's address,
 *     once one is open, is what a row offers so that ⌘-click and the click name
 *     the same URL.
 *
 * The wire-bound outlet (`useOduLaneLink`) is stubbed out of the module graph:
 * these decisions need no socket, and a test that opened one would be testing
 * the wire rather than the decision.
 */

import { formatLogKey } from "@odu/service-client/logKey";
import { logHash } from "@odu/service-client/routes";
import { describe, expect, it, vi } from "vitest";

vi.mock("../wire", () => ({ activeHost: () => ({ kind: "local" }) }));
vi.mock("../kaval/useDaemonStatus", () => ({
  isActiveHostLocal: () => true,
}));
vi.mock("../forwards/useForwards", () => ({
  cancelForward: () => Promise.resolve(),
  createForward: () => Promise.resolve({ localPort: 1 }),
  forwardsForHost: () => [],
  viewerHost: () => null,
}));

const { laneHash, oduLaneAct } = await import("./useOduLaneLink");

/** The port a frame carried off the daemon's own greeting — an arbitrary one on
 *  purpose: the link has to dial THIS, not a default. */
const DAEMON_PORT = 18777;

describe("the page a lane points at", () => {
  const run = { runId: "run-1" };

  it("is the lane's own log page once it has one", () => {
    const key = formatLogKey({
      runId: "run-1",
      node: "ci::unit@x86_64-linux",
      attempt: 2,
    });
    expect(laneHash(run, { logKey: key })).toBe(`#/run/${key}`);
  });

  it("is the RUN page for a lane that never started", () => {
    // The empty key is odu's own marker, not a local convention: a node on the
    // roster with no attempt carries `""` so that no face names evidence that
    // does not exist. A lane with no log has no log page — the run is where it
    // is read.
    expect(laneHash(run, { logKey: "" })).toBe("#/run/run-1");
  });
});

describe("how a lane is reached", () => {
  /** A real address, minted by odu's own token rule rather than hand-spelled:
   *  the point of these cases is the ORIGIN it hangs off, not the fragment. */
  const HASH = logHash(
    formatLogKey({
      runId: "run-1",
      node: "ci::unit@x86_64-linux",
      attempt: 2,
    }),
  );
  const base = {
    hash: HASH,
    port: DAEMON_PORT,
    onKoluHost: true,
    pageHost: "pureintent",
  };

  it("links the daemon's own port when the browser IS on its host", () => {
    // No door: the browser's own loopback is the machine the daemon is on, so
    // the address is odu's directly.
    expect(
      oduLaneAct({ ...base, viewerOnHost: true, doorPort: undefined }),
    ).toEqual({
      kind: "address",
      href: `http://localhost:${DAEMON_PORT}${HASH}`,
    });
  });

  it("links through the door that is already open", () => {
    // The door's port, on the host this page came from — the same address
    // `forwardUrl` builds, so a copied link and a click agree.
    expect(
      oduLaneAct({ ...base, viewerOnHost: false, doorPort: 61003 }),
    ).toEqual({
      kind: "address",
      href: `http://pureintent:61003${HASH}`,
    });
  });

  it("offers a door when the browser is elsewhere and none is open", () => {
    expect(
      oduLaneAct({ ...base, viewerOnHost: false, doorPort: undefined }),
    ).toEqual({ kind: "door" });
  });

  it("offers a door for a daemon on a REMOTE host as well", () => {
    // `onKoluHost` cannot change this: a loopback bind is invisible to every
    // other machine whatever host it is on, so both halves of that flag end in
    // the same door.
    expect(
      oduLaneAct({
        ...base,
        onKoluHost: false,
        viewerOnHost: false,
        doorPort: undefined,
      }),
    ).toEqual({ kind: "door" });
  });
});
