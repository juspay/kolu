import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize";

const documentOptions = { links: true, richHtml: true } as const;

function sanitized(raw: string): HTMLElement {
  const root = document.createElement("div");
  const html = sanitizeHtml(raw, documentOptions);
  root.innerHTML = html;
  return root;
}

describe("sanitizeHtml — document allowlist", () => {
  it("unwraps markdown links for links-off intent slots", () => {
    const root = document.createElement("div");
    root.innerHTML = sanitizeHtml(
      '<a href="https://example.com/">visible label</a>',
      { links: false, richHtml: false },
    );

    expect(root.textContent).toBe("visible label");
    expect(root.querySelector("a")).toBeNull();
  });

  it("drops script elements and unwraps script-capable links without losing their text", () => {
    const root = sanitized(
      '<h1>Safe</h1><script>window.__xss=1</script><a href="javascript:window.__xss=2">evil link</a>',
    );

    expect(root.querySelector("h1")?.textContent).toBe("Safe");
    expect(root.textContent).toContain("evil link");
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("keeps prose while dropping style, class, SVG, and interactive form controls", () => {
    const root = sanitized(
      '<p style="color:red" class="takeover">styled para</p><svg><rect /></svg><button>press me</button><input type="text" value="injected">',
    );

    expect(root.textContent).toContain("styled para");
    expect(
      root.querySelector("[style], .takeover, svg, button, input"),
    ).toBeNull();
  });

  it("applies one link policy to raw relative, external, and unsafe anchors", () => {
    const root = sanitized(
      '<a href="docs/guide.md">relative</a><a href="https://example.com/">external</a><a href="javascript:1">unsafe</a>',
    );
    const relative = root.querySelector<HTMLAnchorElement>("a[data-md-rel]");
    const external = root.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/"]',
    );

    expect(relative?.getAttribute("target")).toBeNull();
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(root.textContent).toContain("unsafe");
    expect(root.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("strips a raw wikilink marker instead of bypassing external-link policy", () => {
    const root = sanitized(
      '<a data-md-wikilink="Note" href="https://evil.example/">spoofed link</a>',
    );
    const anchor = root.querySelector("a");

    expect(anchor?.hasAttribute("data-md-wikilink")).toBe(false);
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
