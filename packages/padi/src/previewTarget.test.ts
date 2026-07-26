import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { samePreviewLocation } from "./chromeVocab.ts";
import {
  assertPreviewPath,
  assertPreviewPortAllowed,
  assertPreviewTarget,
  previewPathReject,
} from "./previewTarget.ts";

describe("previewPathReject — path+query only", () => {
  it("accepts rooted paths, relative segments, query, and empty", () => {
    expect(previewPathReject("")).toBeNull();
    expect(previewPathReject("/")).toBeNull();
    expect(previewPathReject("/foo")).toBeNull();
    expect(previewPathReject("/foo?bar=1")).toBeNull();
    expect(previewPathReject("/foo?bar=1#h")).toBeNull();
    expect(previewPathReject("foo")).toBeNull();
    expect(previewPathReject("foo/bar")).toBeNull();
  });

  it("refuses schemes", () => {
    expect(previewPathReject("http://evil")).toEqual({
      kind: "scheme",
      scheme: "http",
    });
    expect(previewPathReject("https://x/y")).toEqual({
      kind: "scheme",
      scheme: "https",
    });
    expect(previewPathReject("about:blank")).toEqual({
      kind: "scheme",
      scheme: "about",
    });
    expect(previewPathReject("javascript:alert(1)")).toEqual({
      kind: "scheme",
      scheme: "javascript",
    });
  });

  it("refuses protocol-relative //", () => {
    expect(previewPathReject("//evil.example/x")).toEqual({
      kind: "protocol-relative",
    });
  });

  it("refuses host-shaped input", () => {
    expect(previewPathReject("localhost:3000")).toEqual({ kind: "host" });
    expect(previewPathReject("example.com/foo")).toEqual({ kind: "host" });
  });
});

describe("assertPreviewPath", () => {
  it("normalises empty and relative to rooted", () => {
    expect(assertPreviewPath("")).toBe("/");
    expect(assertPreviewPath("  ")).toBe("/");
    expect(assertPreviewPath("foo")).toBe("/foo");
    expect(assertPreviewPath("/bar?q=1")).toBe("/bar?q=1");
  });

  it("throws BAD_REQUEST on schemes and //", () => {
    for (const bad of ["http://x", "//x", "https://y/z"]) {
      try {
        assertPreviewPath(bad);
        expect.unreachable(`should have rejected ${bad}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ORPCError);
        expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
      }
    }
  });
});

describe("assertPreviewPortAllowed — door ∪ scan ∪ current", () => {
  it("accepts a scanned port", () => {
    expect(() =>
      assertPreviewPortAllowed({
        port: 5173,
        scannedPorts: new Set([5173]),
        doorPorts: new Set(),
        currentPort: null,
      }),
    ).not.toThrow();
  });

  it("accepts a live door port", () => {
    expect(() =>
      assertPreviewPortAllowed({
        port: 8080,
        scannedPorts: new Set(),
        doorPorts: new Set([8080]),
        currentPort: null,
      }),
    ).not.toThrow();
  });

  it("accepts the current preview port for path-only navigate", () => {
    expect(() =>
      assertPreviewPortAllowed({
        port: 3000,
        scannedPorts: new Set(),
        doorPorts: new Set(),
        currentPort: 3000,
      }),
    ).not.toThrow();
  });

  it("refuses a port with no door or scan", () => {
    try {
      assertPreviewPortAllowed({
        port: 9999,
        scannedPorts: new Set([5173]),
        doorPorts: new Set([8080]),
        currentPort: null,
      });
      expect.unreachable("should refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(ORPCError);
      expect((err as ORPCError<string, unknown>).message).toMatch(
        /not a scanned port or live door/,
      );
    }
  });

  it("refuses a non-TCP port number", () => {
    try {
      assertPreviewPortAllowed({
        port: 0,
        scannedPorts: new Set([0]),
        doorPorts: new Set(),
        currentPort: null,
      });
      expect.unreachable("should refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(ORPCError);
      expect((err as ORPCError<string, unknown>).message).toMatch(/TCP port/);
    }
  });
});

describe("assertPreviewTarget", () => {
  it("returns the normalised location", () => {
    expect(
      assertPreviewTarget({
        port: 5173,
        path: "app",
        scannedPorts: new Set([5173]),
        doorPorts: new Set(),
        currentPort: null,
      }),
    ).toEqual({ port: 5173, path: "/app" });
  });

  it("refuses a raw URL even when the port is allowed", () => {
    expect(() =>
      assertPreviewTarget({
        port: 5173,
        path: "http://localhost:5173/x",
        scannedPorts: new Set([5173]),
        doorPorts: new Set(),
        currentPort: null,
      }),
    ).toThrow(ORPCError);
  });
});

describe("samePreviewLocation — trail isSameEntry", () => {
  it("matches on both fields", () => {
    expect(
      samePreviewLocation({ port: 1, path: "/a" }, { port: 1, path: "/a" }),
    ).toBe(true);
    expect(
      samePreviewLocation({ port: 1, path: "/a" }, { port: 1, path: "/b" }),
    ).toBe(false);
    expect(
      samePreviewLocation({ port: 1, path: "/a" }, { port: 2, path: "/a" }),
    ).toBe(false);
  });
});
