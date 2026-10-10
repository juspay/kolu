// @vitest-environment happy-dom
/**
 * The host tab's connection dot, and the thin forward RING around it.
 *
 * Field feedback replaced a separate `⇄ n` chip with a marker on the dot: the
 * dot is already the click target that opens the dropdown listing the forwards,
 * so a second chip beside it was chrome for a fact the dot could carry.
 *
 * The marker took three cuts to settle, and the shape is now a HAIRLINE ring
 * hugging the pip. A thick teal ring was rejected as jarring — heavy stroke plus
 * offset made it read as a treatment applied to the dot. A corner badge carrying
 * the ⇄ glyph replaced it and failed for the opposite reason: at tab size the
 * glyph is illegible mush. Weight, not shape, was the problem.
 *
 * The load-bearing property survives every cut, and is what this file exists to
 * pin: **the marker never touches the pip's colour.** That colour is painted from
 * the connection-health fact and nothing else (`.claude/rules/solidjs.md` — never
 * colour a status dot from anything but the fact), so it has to compose AROUND
 * the pip. A marker that recoloured it would be a green-over-a-dead-link dot by a
 * new route, which is exactly the class of bug that rule exists to make
 * unrenderable.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import {
  forwardRingLabel,
  HOST_DOT_THROB_CLASS,
  HostStatusDot,
  hostActiveLabel,
} from "./HostStatusDot";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(props: {
  statusDot: string;
  forwardCount: number;
  active?: number;
}) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <HostStatusDot active={0} {...props} />, host);
  return {
    pip: host.querySelector('[data-testid="host-status-pip"]'),
    ring: host.querySelector('[data-testid="host-forward-ring"]'),
  };
}

/** Two real pip tones, so the ring is proved over more than the happy one. */
const READY = "bg-emerald-400";
const DOWN = "bg-rose-400";

describe("HostStatusDot", () => {
  it("draws no ring when the host has no forwards", () => {
    const { pip, ring } = mount({ statusDot: READY, forwardCount: 0 });
    expect(pip).not.toBeNull();
    expect(ring).toBeNull();
  });

  it("draws a ring when the host has forwards", () => {
    const { pip, ring } = mount({ statusDot: READY, forwardCount: 2 });
    expect(pip).not.toBeNull();
    expect(ring).not.toBeNull();
  });

  it("draws nothing and announces nothing — the button owns both", () => {
    // Nothing is DRAWN inside it — not a count, not a glyph. Both were tried at
    // tab scale and both are illegible there; the ring's whole job is "doors are
    // open on this host".
    //
    // And nothing is ANNOUNCED here either. The ring is `pointer-events-none`,
    // so a `title` on it could never be hovered, and a second accessible name
    // for one fact is a second thing to keep in step. The enclosing button in
    // `HostSelectorStrip` appends `forwardRingLabel` to its own label, which is
    // the copy a user actually gets; the count stays here only as data, for the
    // tests and for anyone inspecting the DOM.
    const { ring } = mount({ statusDot: READY, forwardCount: 2 });
    expect(ring?.textContent?.trim()).toBe("");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(ring?.getAttribute("aria-label")).toBeNull();
    expect(ring?.getAttribute("data-count")).toBe("2");
  });

  it("says 'port' rather than 'ports' for one", () => {
    // The copy itself, tested at its source now that the ring no longer carries
    // it — the pluralization is the part worth pinning, wherever it is rendered.
    expect(forwardRingLabel(1)).toMatch(/1 forwarded port\b/);
    expect(forwardRingLabel(1)).not.toMatch(/ports/);
    expect(forwardRingLabel(2)).toMatch(/2 forwarded ports/);
  });

  it("leaves the pip's COLOUR untouched, forwards or not", () => {
    // The hard rule: the pip is painted from the connection-health fact alone.
    // The ring composes around it and may never recolour or replace it.
    const without = mount({ statusDot: READY, forwardCount: 0 }).pip?.className;
    dispose?.();
    host?.remove();
    const withRing = mount({ statusDot: READY, forwardCount: 3 }).pip
      ?.className;
    expect(withRing).toBe(without);
    expect(withRing).toContain(READY);
  });

  it("renders the ring over a DOWN pip too, not just a healthy one", () => {
    // A host can be unreachable while kolu still holds doors it opened before
    // the link dropped, so the ring has to read over every pip state.
    const { pip, ring } = mount({ statusDot: DOWN, forwardCount: 1 });
    expect(ring).not.toBeNull();
    expect(pip?.className).toContain(DOWN);
  });

  it("is a HAIRLINE — the weight is what made the first ring jarring", () => {
    // Not the shape: an outline around the pip is the right idea, and the
    // corner badge that replaced it proved illegible at this size. What made
    // the first ring heavy-handed was the stroke plus its offset, so this one
    // is a single pixel sitting tight against the pip.
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.className).toMatch(/(^|\s)ring-1(\s|$)/);
    expect(ring?.className).not.toMatch(/ring-2|ring-4|border-2/);
    expect(ring?.className).not.toMatch(/ring-offset-[1-9]/);
  });

  it("throbs while the host has active terminals, and is still otherwise", () => {
    // The host tab's working spinner + count used to sit beside the name and
    // come and go as agents started and stopped — the tab's width changed with
    // it and the whole strip shifted. The fact moved onto the dot as MOTION.
    const still = mount({ statusDot: READY, forwardCount: 0, active: 0 }).pip;
    expect(still?.className).not.toMatch(/host-dot-throb/);
    expect(still?.hasAttribute("data-throb")).toBe(false);
    dispose?.();
    host?.remove();
    const busy = mount({ statusDot: READY, forwardCount: 0, active: 2 }).pip;
    expect(busy?.className).toMatch(/host-dot-throb/);
    expect(busy?.className).toMatch(/motion-reduce:animate-none/);
    expect(busy?.hasAttribute("data-throb")).toBe(true);
  });

  it("the throb never touches the pip's COLOUR or SIZE", () => {
    // Motion only: the colour is the connection fact, the box is the tab's
    // geometry. Strip the throb tokens and what is left must be identical.
    const base = mount({ statusDot: DOWN, forwardCount: 0, active: 0 }).pip
      ?.className;
    dispose?.();
    host?.remove();
    const busy = mount({ statusDot: DOWN, forwardCount: 0, active: 5 }).pip
      ?.className;
    const strip = (c: string | undefined) =>
      (c ?? "")
        .split(/\s+/)
        .filter((t) => t !== "host-dot-throb" && !t.startsWith("motion-"))
        .join(" ");
    expect(strip(busy)).toBe(strip(base));
    expect(busy).toContain(DOWN);
  });

  it("the throb class is motion-only and freezes under reduced motion", () => {
    expect(HOST_DOT_THROB_CLASS).toContain("motion-reduce:animate-none");
    // Never a colour token: the dot it rides paints the connection fact.
    expect(HOST_DOT_THROB_CLASS).not.toMatch(/(^|\s)(text|bg|ring|border)-/);
  });

  it("the throb rides the pip alone and peaks inside the forward ring", () => {
    // The ring is the pip's SIBLING, so the colour/size test above can't see
    // it: a throb that swelled the pip past the ring's inner edge would erase
    // the ring at every beat on a host that holds forwards. Read the real peak
    // from the keyframe and the real sizes from the rendered Tailwind tokens.
    const { pip, ring } = mount({
      statusDot: READY,
      forwardCount: 2,
      active: 3,
    });
    expect(pip?.className).toMatch(/host-dot-throb/);
    expect(ring?.className).not.toMatch(/host-dot-throb/);
    // Tailwind `h-N` is N × 4px; `ring-1` draws OUTSIDE the box, so the ring's
    // inner edge is the box itself.
    const px = (el: Element | null) =>
      Number(/(?:^|\s)h-([\d.]+)(?:\s|$)/.exec(el?.className ?? "")?.[1]) * 4;
    expect(ring?.className).toMatch(/(^|\s)ring-1(\s|$)/);
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../index.css"),
      "utf8",
    );
    const keyframes = /@keyframes host-dot-throb\s*\{([\s\S]*?)\n\}/.exec(
      css,
    )?.[1];
    const scales = [...(keyframes ?? "").matchAll(/scale\(([\d.]+)\)/g)].map(
      (m) => Number(m[1]),
    );
    expect(scales.length).toBeGreaterThan(0);
    const peak = px(pip) * Math.max(...scales);
    expect(peak).toBeLessThan(px(ring));
  });

  it("says 'terminal' rather than 'terminals' for one", () => {
    expect(hostActiveLabel(1)).toBe("1 terminal active");
    expect(hostActiveLabel(3)).toBe("3 terminals active");
  });

  it("marks in the FORWARD colour, never the connection colour", () => {
    // The one binding rule of the approved UX pass: green means connection
    // health, teal means open doors, and neither surface may borrow the other's.
    // A green marker is a second, quieter way of saying "connected" rather than
    // a fact of its own — which is what the first cut drew by reusing the accent.
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.className).toMatch(/teal/);
    expect(ring?.className).not.toMatch(/emerald|green|accent/);
  });
});
