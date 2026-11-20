// @vitest-environment happy-dom

import { formatLogKey } from "@odu/service-client/logKey";
import { logHash } from "@odu/service-client/routes";
import { describe, expect, it, vi } from "vitest";

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => undefined },
}));
vi.mock("../kaval/useDaemonStatus", () => ({
  isActiveHostLocal: () => true,
}));
vi.mock("../forwards/useForwards", () => ({
  cancelForward: () => Promise.resolve(),
  createForward: () => Promise.resolve({ localPort: 1 }),
  forwardsForHost: () => [],
  viewerHost: () => null,
}));

const { oduLinkAct } = await import("./useOduLink");

const DAEMON_PORT = 18777;

describe("how an odu link is reached", () => {
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
    expect(
      oduLinkAct({ ...base, viewerOnHost: true, doorPort: undefined }),
    ).toEqual({
      kind: "address",
      href: `http://localhost:${DAEMON_PORT}${HASH}`,
    });
  });

  it("links through the door that is already open", () => {
    expect(
      oduLinkAct({ ...base, viewerOnHost: false, doorPort: 61003 }),
    ).toEqual({
      kind: "address",
      href: `http://pureintent:61003${HASH}`,
    });
  });

  it("offers a door when the browser is elsewhere and none is open", () => {
    expect(
      oduLinkAct({ ...base, viewerOnHost: false, doorPort: undefined }),
    ).toEqual({ kind: "door" });
  });

  it("offers a door for a daemon on a REMOTE host as well", () => {
    expect(
      oduLinkAct({
        ...base,
        onKoluHost: false,
        viewerOnHost: false,
        doorPort: undefined,
      }),
    ).toEqual({ kind: "door" });
  });
});
