import { describe, it, expect } from "vitest";
import { matchPreviewHost } from "./hostMatch.ts";

describe("matchPreviewHost", () => {
  it("returns the port for a sslip.io-shaped preview host", () => {
    expect(matchPreviewHost("5173.preview.100-64-0-1.sslip.io:7692")).toBe(
      5173,
    );
  });

  it("returns the port for a *.localhost preview host", () => {
    expect(matchPreviewHost("3000.preview.localhost:7681")).toBe(3000);
  });

  it("returns null for a bare host that isn't a preview", () => {
    expect(matchPreviewHost("pureintent:7692")).toBeNull();
    expect(matchPreviewHost("localhost:7681")).toBeNull();
  });

  it("returns null for privileged ports", () => {
    expect(matchPreviewHost("80.preview.localhost")).toBeNull();
    expect(matchPreviewHost("1023.preview.localhost")).toBeNull();
  });

  it("returns null for out-of-range ports", () => {
    expect(matchPreviewHost("0.preview.localhost")).toBeNull();
    expect(matchPreviewHost("99999.preview.localhost")).toBeNull();
  });

  it("returns null for undefined / empty host", () => {
    expect(matchPreviewHost(undefined)).toBeNull();
    expect(matchPreviewHost("")).toBeNull();
  });

  it("does not match `preview` without a port prefix", () => {
    expect(matchPreviewHost("preview.localhost")).toBeNull();
    expect(matchPreviewHost("foo.preview.localhost")).toBeNull();
  });
});
