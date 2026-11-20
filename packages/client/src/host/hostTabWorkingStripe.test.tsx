// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { HostTabWorkingStripe, hostActiveLabel } from "./HostTabWorkingStripe";

const STRIPE = '[data-testid="host-tab-working-stripe"]';

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mountInTab(active: () => number) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <div class="host-tab relative flex h-8 items-center" data-testid="tab">
        <span>Home</span>
        <HostTabWorkingStripe active={active()} />
      </div>
    ),
    host,
  );
  return {
    tab: host.querySelector('[data-testid="tab"]') as HTMLElement,
    stripe: () => host?.querySelector(STRIPE) ?? null,
  };
}

const indexCss = () =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../index.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

function stripeRules(css: string): string[] {
  return [...css.matchAll(/([^{}]*\.host-tab-stripe[^{}]*)\{([^{}]*)\}/g)].map(
    (m) => `${m[1]}{${m[2]}}`,
  );
}

describe("HostTabWorkingStripe", () => {
  it("is mounted only while the host has active terminals", () => {
    const [active, setActive] = createSignal(0);
    const { stripe } = mountInTab(active);
    expect(stripe()).toBeNull();
    setActive(2);
    expect(stripe()).not.toBeNull();
    setActive(0);
    expect(stripe()).toBeNull();
  });

  it("carries no layout: absolute on the bottom edge, the tab's box unchanged", () => {
    const [active, setActive] = createSignal(0);
    const { tab, stripe } = mountInTab(active);
    const idleWidth = tab.offsetWidth;
    const idleHeight = tab.offsetHeight;
    setActive(1);
    const classes = (stripe()?.className ?? "").split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "absolute",
        "bottom-0",
        "inset-x-2.5",
        "pointer-events-none",
      ]),
    );
    expect(tab.offsetWidth).toBe(idleWidth);
    expect(tab.offsetHeight).toBe(idleHeight);
  });

  it("never paints a connection colour or the host hue", () => {
    const { stripe } = mountInTab(() => 3);
    const subtree = [
      stripe(),
      ...(stripe()?.querySelectorAll("*") ?? []),
    ] as Element[];
    for (const el of subtree) {
      expect(el.className).not.toMatch(
        /(^|\s)(bg|text|border|ring)-(emerald|amber|red|fg-3)/,
      );
    }
    const rules = stripeRules(indexCss());
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/--host-hue|--color-(ok|success|warn|danger)/);
    }
    expect(rules.join("\n")).toMatch(/var\(--color-busy\)/);
  });

  it("stops sweeping under reduced motion but keeps the stripe visible", () => {
    const css = indexCss();
    const reduced = [
      ...css.matchAll(
        /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g,
      ),
    ]
      .map((m) => m[1])
      .find((body) => body?.includes(".host-tab-stripe"));
    expect(reduced).toBeDefined();
    expect(reduced).toMatch(
      /\.host-tab-stripe-segment\s*\{\s*animation:\s*none;?\s*\}/,
    );
    expect(reduced).not.toMatch(/display:\s*none|opacity:\s*0|visibility/);
  });

  it("says 'terminal' rather than 'terminals' for one", () => {
    expect(hostActiveLabel(1)).toBe("1 terminal active");
    expect(hostActiveLabel(3)).toBe("3 terminals active");
  });
});
