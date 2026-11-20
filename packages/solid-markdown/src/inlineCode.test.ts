import { describe, expect, it } from "vitest";
import { decorateInlineCode, type InlineCodeAction } from "./inlineCode";

const only =
  (name: string, current = false) =>
  (text: string): InlineCodeAction | undefined =>
    text === name ? { label: `Open ${name}`, current } : undefined;

const parse = (html: string): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("inline code a host can act on", () => {
  it("wraps the span the host answers for in a named button, around the same code", () => {
    const el = parse(
      decorateInlineCode(
        "<p>see <code>plan.md</code> and <code>other.md</code></p>",
        only("plan.md"),
      ),
    );
    const button = el.querySelector("button");
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Open plan.md");
    expect(button?.getAttribute("aria-current")).toBeNull();
    expect(button?.querySelector("code")?.textContent).toBe("plan.md");
    expect(el.querySelectorAll("button")).toHaveLength(1);
    expect(el.querySelectorAll("code")).toHaveLength(2);
  });

  it("marks the one the host has open", () => {
    const el = parse(
      decorateInlineCode("<code>plan.md</code>", only("plan.md", true)),
    );
    expect(el.querySelector("button")?.getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("never touches code in a block", () => {
    const html = "<pre><code>plan.md</code></pre>";
    expect(decorateInlineCode(html, only("plan.md"))).toBe(html);
  });

  it("keeps the span's text as text, whatever it looks like", () => {
    const name = '<img src=x onerror="1">';
    const el = parse(
      decorateInlineCode(
        '<code>&lt;img src=x onerror="1"&gt;</code>',
        only(name),
      ),
    );
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("code")?.textContent).toBe(name);
    expect(
      el.querySelector("button")?.getAttribute("data-md-code-action"),
    ).toBe(name);
  });
});
