import { describe, expect, it } from "vitest";
import { classifyAnchor } from "./deepLink";

const LOC = {
  origin: "http://localhost:7690",
  pathname: "/terminal-file/abc/preview/index.html",
};

const PLAIN = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("classifyAnchor — the in-sandbox anchor classifier (DL2 pins)", () => {
  it("classifies a same-origin app-root #/t link (the dashboard-pill shape) as deep-link", () => {
    expect(
      classifyAnchor({ href: `${LOC.origin}/#/t/local/${ID}` }, LOC, PLAIN),
    ).toEqual({ kind: "deep-link", hash: `#/t/local/${ID}` });
  });

  it("classifies a same-page #/… href (resolves to the document's own path) as deep-link", () => {
    expect(
      classifyAnchor(
        { href: `${LOC.origin}${LOC.pathname}#/settings` },
        LOC,
        PLAIN,
      ),
    ).toEqual({ kind: "deep-link", hash: "#/settings" });
  });

  it("classifies a cross-origin link as external", () => {
    expect(
      classifyAnchor({ href: "https://other.example/page" }, LOC, PLAIN),
    ).toEqual({ kind: "external", url: "https://other.example/page" });
  });

  it("classifies a cross-origin #/… link as external, never deep-link", () => {
    expect(
      classifyAnchor(
        { href: `https://other.example/#/t/local/${ID}` },
        LOC,
        PLAIN,
      ),
    ).toEqual({
      kind: "external",
      url: `https://other.example/#/t/local/${ID}`,
    });
  });

  it("classifies a same-HOST link over a different scheme as external (origin is the boundary)", () => {
    expect(
      classifyAnchor({ href: `https://localhost:7690/` }, LOC, PLAIN),
    ).toEqual({
      kind: "external",
      url: "https://localhost:7690/",
    });
  });

  it("classifies an internal file link (different path = file nav) as in-frame, hash or not", () => {
    expect(
      classifyAnchor({ href: `${LOC.origin}/other/page.html` }, LOC, PLAIN),
    ).toEqual({ kind: "in-frame" });
    expect(
      classifyAnchor(
        { href: `${LOC.origin}/other/page.html#/t/x` },
        LOC,
        PLAIN,
      ),
    ).toEqual({ kind: "in-frame" });
  });

  it("classifies a bare # or an ordinary in-page anchor as in-frame", () => {
    expect(
      classifyAnchor({ href: `${LOC.origin}${LOC.pathname}#` }, LOC, PLAIN),
    ).toEqual({ kind: "in-frame" });
    expect(
      classifyAnchor(
        { href: `${LOC.origin}${LOC.pathname}#section-2` },
        LOC,
        PLAIN,
      ),
    ).toEqual({ kind: "in-frame" });
  });

  it("classifies non-web schemes as in-frame (left to the browser's own handling)", () => {
    expect(
      classifyAnchor({ href: "mailto:x@example.com" }, LOC, PLAIN),
    ).toEqual({
      kind: "in-frame",
    });
    expect(classifyAnchor({ href: "javascript:alert(1)" }, LOC, PLAIN)).toEqual(
      { kind: "in-frame" },
    );
  });
});

describe("classifyAnchor — only a plain primary click may navigate the current window", () => {
  const deepLink = { href: `${LOC.origin}/#/t/local/${ID}` };

  it("deep-links a plain left click", () => {
    expect(classifyAnchor(deepLink, LOC, PLAIN)).toEqual({
      kind: "deep-link",
      hash: `#/t/local/${ID}`,
    });
  });

  it("leaves the middle button (open in a new tab) in-frame", () => {
    expect(classifyAnchor(deepLink, LOC, { ...PLAIN, button: 1 })).toEqual({
      kind: "in-frame",
    });
  });

  it("leaves every open-elsewhere modifier in-frame", () => {
    for (const modifier of [
      "ctrlKey",
      "metaKey",
      "shiftKey",
      "altKey",
    ] as const) {
      expect(
        classifyAnchor(deepLink, LOC, { ...PLAIN, [modifier]: true }),
      ).toEqual({ kind: "in-frame" });
    }
  });
});
