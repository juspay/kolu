import { describe, expect, it } from "vitest";
import { previewFrameTarget } from "./previewUrl";

const loc = { port: 5173, path: "/app" };

describe("previewFrameTarget", () => {
  it("direct-here uses the page host and the server port", () => {
    expect(
      previewFrameTarget({
        location: loc,
        action: { kind: "here" },
        localPort: undefined,
        pageHostname: "kolu.example",
      }),
    ).toEqual({ kind: "url", href: "http://kolu.example:5173/app" });
  });

  it("viewer uses localhost", () => {
    expect(
      previewFrameTarget({
        location: loc,
        action: { kind: "viewer" },
        localPort: undefined,
        pageHostname: "kolu.example",
      }),
    ).toEqual({ kind: "url", href: "http://localhost:5173/app" });
  });

  it("forward uses the door's local port on the page host", () => {
    expect(
      previewFrameTarget({
        location: loc,
        action: { kind: "forward" },
        localPort: 61003,
        pageHostname: "kolu.example",
      }),
    ).toEqual({ kind: "url", href: "http://kolu.example:61003/app" });
  });

  it("forward without a door is door-closed", () => {
    expect(
      previewFrameTarget({
        location: loc,
        action: { kind: "forward" },
        localPort: undefined,
        pageHostname: "kolu.example",
      }),
    ).toEqual({ kind: "door-closed" });
  });

  it("rooted path `/` does not double-slash", () => {
    expect(
      previewFrameTarget({
        location: { port: 80, path: "/" },
        action: { kind: "here" },
        localPort: undefined,
        pageHostname: "h",
      }),
    ).toEqual({ kind: "url", href: "http://h:80" });
  });

  it("none is unreachable", () => {
    expect(
      previewFrameTarget({
        location: loc,
        action: { kind: "none" },
        localPort: undefined,
        pageHostname: "h",
      }),
    ).toEqual({ kind: "unreachable" });
  });
});
