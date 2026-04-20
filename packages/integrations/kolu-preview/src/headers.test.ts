import { describe, it, expect } from "vitest";
import { buildUpstreamHeaders, stripFramingHeaders } from "./headers.ts";

describe("buildUpstreamHeaders", () => {
  it("drops hop-by-hop headers and the incoming Host", () => {
    const incoming = new Headers({
      host: "5173.preview.localhost:7681",
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      accept: "text/html",
      cookie: "session=abc",
    });
    const out = buildUpstreamHeaders(
      incoming,
      "5173.preview.localhost",
      "http",
    );
    expect(out.get("host")).toBeNull();
    expect(out.get("connection")).toBeNull();
    expect(out.get("transfer-encoding")).toBeNull();
    expect(out.get("accept")).toBe("text/html");
    expect(out.get("cookie")).toBe("session=abc");
  });

  it("adds X-Forwarded-Host and X-Forwarded-Proto", () => {
    const out = buildUpstreamHeaders(
      new Headers(),
      "5173.preview.foo.sslip.io:7692",
      "https",
    );
    expect(out.get("x-forwarded-host")).toBe("5173.preview.foo.sslip.io:7692");
    expect(out.get("x-forwarded-proto")).toBe("https");
  });
});

describe("stripFramingHeaders", () => {
  it("removes X-Frame-Options", () => {
    const out = stripFramingHeaders(new Headers({ "x-frame-options": "DENY" }));
    expect(out.get("x-frame-options")).toBeNull();
  });

  it("drops the frame-ancestors directive from CSP but keeps the rest", () => {
    const out = stripFramingHeaders(
      new Headers({
        "content-security-policy":
          "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
      }),
    );
    const csp = out.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp!.toLowerCase()).not.toContain("frame-ancestors");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
  });

  it("removes the CSP header entirely when frame-ancestors was its only directive", () => {
    const out = stripFramingHeaders(
      new Headers({ "content-security-policy": "frame-ancestors 'none'" }),
    );
    expect(out.get("content-security-policy")).toBeNull();
  });

  it("passes CSP through unchanged when frame-ancestors is absent", () => {
    const out = stripFramingHeaders(
      new Headers({
        "content-security-policy": "default-src 'self'; script-src 'self'",
      }),
    );
    expect(out.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'",
    );
  });

  it("is a no-op when neither header is present", () => {
    const out = stripFramingHeaders(new Headers({ accept: "text/html" }));
    expect(out.get("x-frame-options")).toBeNull();
    expect(out.get("content-security-policy")).toBeNull();
    expect(out.get("accept")).toBe("text/html");
  });
});
