import { describe, it, expect } from "vitest";
import { parseFramingHeaders } from "./browserProbe.ts";

describe("parseFramingHeaders", () => {
  it("reports blocked on X-Frame-Options: DENY (any case)", () => {
    expect(parseFramingHeaders({ xFrameOptions: "DENY" })).toEqual({
      blocked: true,
      reason: "X-Frame-Options: deny",
    });
    expect(parseFramingHeaders({ xFrameOptions: "deny" })).toEqual({
      blocked: true,
      reason: "X-Frame-Options: deny",
    });
  });

  it("reports blocked on X-Frame-Options: SAMEORIGIN", () => {
    expect(parseFramingHeaders({ xFrameOptions: "SAMEORIGIN" })).toEqual({
      blocked: true,
      reason: "X-Frame-Options: sameorigin",
    });
  });

  it("ignores X-Frame-Options values other than DENY/SAMEORIGIN", () => {
    // ALLOW-FROM is deprecated and browsers ignore it — we match the browser.
    expect(
      parseFramingHeaders({ xFrameOptions: "ALLOW-FROM https://example.com" }),
    ).toEqual({ blocked: false });
  });

  it("reports blocked on CSP frame-ancestors 'none'", () => {
    expect(
      parseFramingHeaders({
        contentSecurityPolicy:
          "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
      }),
    ).toEqual({ blocked: true, reason: "CSP frame-ancestors 'none'" });
  });

  it("reports blocked on CSP frame-ancestors 'self'", () => {
    expect(
      parseFramingHeaders({
        contentSecurityPolicy: "frame-ancestors 'self'",
      }),
    ).toEqual({ blocked: true, reason: "CSP frame-ancestors 'self'" });
  });

  it("passes CSP frame-ancestors with an explicit origin through", () => {
    // Not 'none' / 'self' — we can't tell if our origin is allowed, so we
    // don't block proactively. The iframe load will handle it.
    expect(
      parseFramingHeaders({
        contentSecurityPolicy: "frame-ancestors https://example.com",
      }),
    ).toEqual({ blocked: false });
  });

  it("returns unblocked when no restrictive headers are present", () => {
    expect(parseFramingHeaders({})).toEqual({ blocked: false });
    expect(
      parseFramingHeaders({
        xFrameOptions: null,
        contentSecurityPolicy: null,
      }),
    ).toEqual({ blocked: false });
    expect(
      parseFramingHeaders({
        contentSecurityPolicy: "default-src 'self'; script-src 'self'",
      }),
    ).toEqual({ blocked: false });
  });
});
