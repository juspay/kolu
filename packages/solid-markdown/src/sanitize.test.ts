import { describe, expect, it } from "vitest";
import type { Diagram } from "./diagram";
import { renderMarkdownToRawHtml } from "./render";
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

describe("sanitizeHtml — mermaid diagrams", () => {
  const SOURCE = "flowchart TD\n  A --> B";
  const MARKDOWN = `Before.\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n\nAfter.`;
  // A hostile drawing: the SVG text carries a script and an event handler.
  const svgUrl = (fill: string) =>
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><script>window.__xss=2</script><rect fill="${fill}"/></svg>`,
    )}`;
  const drawn: Diagram = {
    ok: true,
    light: { src: svgUrl("white"), width: 120, height: 80 },
    dark: { src: svgUrl("black"), width: 121, height: 80 },
  };
  const FAILURE = 'Parse error on line 2: <img src=x onerror="window.__xss=3">';
  const failed: Diagram = { ok: false, message: FAILURE };

  const scopes = [
    { name: "document", breaks: false, rich: true },
    { name: "compact", breaks: true, rich: false },
  ] as const;

  function render(
    markdown: string,
    scope: (typeof scopes)[number],
    diagram?: (source: string) => Diagram | undefined,
  ): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = sanitizeHtml(
      renderMarkdownToRawHtml(markdown, {
        breaks: scope.breaks,
        rawHtml: scope.rich,
        frontMatter: scope.rich,
      }),
      { links: true, richHtml: scope.rich, diagram },
    );
    return root;
  }

  for (const scope of scopes) {
    describe(`${scope.name} scope`, () => {
      it("swaps a drawn block for a figure of two sized images, with no SVG markup in the DOM", () => {
        const root = render(MARKDOWN, scope, (s) =>
          s === SOURCE ? drawn : undefined,
        );
        const imgs = root.querySelectorAll("figure[data-md-diagram] img");

        expect(
          Array.from(imgs, (img) => [
            img.getAttribute("data-md-scheme"),
            img.getAttribute("width"),
            img.getAttribute("height"),
            img.getAttribute("src")?.startsWith("data:image/svg+xml"),
          ]),
        ).toEqual([
          ["light", "120", "80", true],
          ["dark", "121", "80", true],
        ]);
        expect(root.querySelector("pre")).toBeNull();
        expect(root.querySelector("svg, script, [onload]")).toBeNull();
        expect(root.textContent).toContain("After.");
      });

      it("keeps an undrawable block's source and shows the reason as text", () => {
        const root = render(MARKDOWN, scope, () => failed);
        const error = root.querySelector("[data-md-diagram-error]");

        expect(root.querySelector("pre")?.textContent).toBe(SOURCE);
        expect(error?.textContent).toBe(FAILURE);
        // The note sits under its block (in the document scope, under the
        // copy-button wrapper), never above it.
        expect(error?.previousElementSibling?.textContent).toContain(SOURCE);
        expect(error?.querySelector("img")).toBeNull();
        expect(root.querySelector("figure")).toBeNull();
        expect(root.querySelector("[data-md-copy]") !== null).toBe(scope.rich);
      });

      it("renders a block with no result exactly as before", () => {
        const withHook = render(MARKDOWN, scope, () => undefined);
        const without = render(MARKDOWN, scope);
        expect(withHook.innerHTML).toBe(without.innerHTML);
        expect(withHook.querySelector("pre")?.textContent).toBe(SOURCE);
      });
    });
  }

  it("still drops an image the author wrote in compact text, while the diagram draws", () => {
    const root = render(
      `![x](https://example.com/a.png)\n\n${MARKDOWN}`,
      scopes[1],
      (s) => (s === SOURCE ? drawn : undefined),
    );
    expect(
      Array.from(root.querySelectorAll("img"), (img) =>
        img.getAttribute("data-md-scheme"),
      ),
    ).toEqual(["light", "dark"]);
  });
});
