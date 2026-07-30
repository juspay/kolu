import { describe, expect, it } from "vitest";
import { hasOwnScheme, isLoadableImage, safeHref } from "./url-policy";

describe("safeHref", () => {
  it("keeps web, mail, hash, and repo-relative links verbatim", () => {
    for (const href of [
      "https://example.com/a",
      "http://example.com/a",
      "mailto:team@example.com",
      "#section",
      "docs/guide.md",
    ]) {
      expect(safeHref(href)).toBe(href);
    }
  });

  it("rejects empty, script-capable, data, and unknown schemes", () => {
    for (const href of [
      "",
      "javascript:alert(1)",
      "data:text/html,pwned",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(safeHref(href)).toBeUndefined();
    }
  });
});

describe("URL shape used by Markdown policy", () => {
  it("distinguishes absolute links from repo-relative links", () => {
    expect(hasOwnScheme("https://example.com")).toBe(true);
    expect(hasOwnScheme("mailto:team@example.com")).toBe(true);
    expect(hasOwnScheme("docs/guide.md")).toBe(false);
  });

  it("loads only web and inline-image sources without host resolution", () => {
    expect(isLoadableImage("https://example.com/logo.png")).toBe(true);
    expect(isLoadableImage("data:image/png;base64,AA==")).toBe(true);
    expect(isLoadableImage("docs/logo.png")).toBe(false);
  });
});
