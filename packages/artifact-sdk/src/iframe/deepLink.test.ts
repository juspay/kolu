import { describe, expect, it } from "vitest";
import { koluDeepLinkHash } from "./deepLink";

/** The previewed document's location: same shape the iframe passes
 *  (`window.location` at the call site). The preview serves under the
 *  terminal-file route, so its pathname is never `/`. */
const LOC = {
  origin: "http://localhost:7690",
  pathname: "/terminal-file/abc/preview/index.html",
};

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("koluDeepLinkHash — the in-sandbox deep-link shape test (DL2 pins)", () => {
  it("classifies a same-origin app-root #/t link (the dashboard-pill shape)", () => {
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}/#/t/local/${ID}` }, LOC),
    ).toBe(`#/t/local/${ID}`);
  });

  it("classifies a same-page #/… href (resolves to the document's own path)", () => {
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}${LOC.pathname}#/settings` }, LOC),
    ).toBe("#/settings");
  });

  it("does NOT classify a cross-origin #/… link (external wins)", () => {
    expect(
      koluDeepLinkHash({ href: `https://other.example/#/t/local/${ID}` }, LOC),
    ).toBeNull();
  });

  it("does NOT classify an internal file link (different path = file nav), hash or not", () => {
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}/other/page.html` }, LOC),
    ).toBeNull();
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}/other/page.html#/t/x` }, LOC),
    ).toBeNull();
  });

  it("does NOT classify a bare # or an ordinary in-page anchor", () => {
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}${LOC.pathname}#` }, LOC),
    ).toBeNull();
    expect(
      koluDeepLinkHash({ href: `${LOC.origin}${LOC.pathname}#section-2` }, LOC),
    ).toBeNull();
  });

  it("does NOT classify non-web schemes", () => {
    expect(koluDeepLinkHash({ href: "mailto:x@example.com" }, LOC)).toBeNull();
    expect(koluDeepLinkHash({ href: "javascript:alert(1)" }, LOC)).toBeNull();
  });
});
