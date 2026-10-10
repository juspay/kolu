// @vitest-environment happy-dom
/**
 * The host tab's running stripe: the "something is happening on this machine"
 * fact, drawn along the tab's bottom edge.
 *
 * It replaced a spinner + count beside the host name, whose coming and going
 * changed the tab's width and shifted every tab after it. So the contract is:
 * mounted only while a terminal is active, gone otherwise; no layout of its
 * own; painted in the active colour only, never a connection colour (the dot
 * owns "connected"); and under reduced motion the sweep stops but the stripe
 * stays visible.
 */

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

/** The stripe inside a stand-in for the tab: `.host-tab` is `relative` in the
 *  real shell, which is what the stripe's absolute box anchors to. */
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

/** `index.css` with comments stripped, so prose that NAMES a forbidden token
 *  (the stripe's own header says "never `--host-hue`") is not read as a rule. */
const indexCss = () =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../index.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule body in `index.css` whose selector names the stripe. */
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
    // Gone, not hidden: the DOM carries nothing once work stops.
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
    // The positioning is what keeps the box still; happy-dom does no layout, so
    // these classes are the load-bearing assertion here, and the recorded
    // evidence measures the real tab in a browser.
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
      // The dot's palette (`hostChipTone`): emerald / amber / red / fg-3.
      expect(el.className).not.toMatch(
        /(^|\s)(bg|text|border|ring)-(emerald|amber|red|fg-3)/,
      );
    }
    const rules = stripeRules(indexCss());
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/--host-hue|--color-(ok|success|warn|danger)/);
    }
    // The active colour, the same rust as the working spinner.
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
    // Freezing the motion must not take the fact with it.
    expect(reduced).not.toMatch(/display:\s*none|opacity:\s*0|visibility/);
  });

  it("says 'terminal' rather than 'terminals' for one", () => {
    expect(hostActiveLabel(1)).toBe("1 terminal active");
    expect(hostActiveLabel(3)).toBe("3 terminals active");
  });
});
