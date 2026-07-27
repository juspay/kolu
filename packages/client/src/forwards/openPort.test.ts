/**
 * The three-layer open flow — decision pure, act separate, effect at the edge.
 */

import { describe, expect, it } from "vitest";
import { urlForPort, withRemainder } from "./openPort";

describe("withRemainder", () => {
  it("appends a real path, query, and hash", () => {
    expect(
      withRemainder("http://pureintent:61000", {
        pathname: "/notes/today",
        search: "?q=1",
        hash: "#x",
      }),
    ).toBe("http://pureintent:61000/notes/today?q=1#x");
  });

  it("does not force a trailing slash for a bare /", () => {
    expect(
      withRemainder("http://pureintent:61000", {
        pathname: "/",
        search: "",
        hash: "",
      }),
    ).toBe("http://pureintent:61000");
  });
});

describe("urlForPort", () => {
  const pageHost = "pureintent";

  it("builds a direct URL on the page host for a here action", () => {
    expect(
      urlForPort({
        action: { kind: "here" },
        remotePort: 5173,
        pageHost,
      }),
    ).toEqual({ kind: "ready", url: "http://pureintent:5173" });
  });

  it("builds a viewer URL on localhost", () => {
    expect(
      urlForPort({
        action: { kind: "viewer" },
        remotePort: 5173,
        pageHost,
      }),
    ).toEqual({ kind: "ready", url: "http://localhost:5173" });
  });

  it("needs a door when the action is forward and no door port is known", () => {
    expect(
      urlForPort({
        action: { kind: "forward" },
        remotePort: 5173,
        pageHost,
      }),
    ).toEqual({ kind: "needs-door" });
  });

  it("builds the door URL once the local port is known, path preserved", () => {
    expect(
      urlForPort({
        action: { kind: "forward" },
        remotePort: 5173,
        doorPort: 61000,
        pageHost,
        remainder: {
          pathname: "/app",
          search: "?x=1",
          hash: "",
        },
      }),
    ).toEqual({ kind: "ready", url: "http://pureintent:61000/app?x=1" });
  });

  it("keeps https from the printout so TLS rides the door", () => {
    expect(
      urlForPort({
        action: { kind: "forward" },
        remotePort: 5173,
        doorPort: 61000,
        pageHost,
        remainder: {
          pathname: "/",
          search: "",
          hash: "",
          protocol: "https:",
        },
      }),
    ).toEqual({ kind: "ready", url: "https://pureintent:61000" });
  });

  it("says none when nothing reaches the port", () => {
    expect(
      urlForPort({
        action: { kind: "none" },
        remotePort: 5173,
        pageHost,
      }),
    ).toEqual({ kind: "none" });
  });

  it("never embeds a literal localhost for a here action", () => {
    const decided = urlForPort({
      action: { kind: "here" },
      remotePort: 443,
      pageHost,
    });
    expect(decided.kind).toBe("ready");
    if (decided.kind === "ready") {
      expect(decided.url).not.toContain("localhost");
    }
  });
});
