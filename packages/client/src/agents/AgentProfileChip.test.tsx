// @vitest-environment happy-dom
/**
 * The tile header's agent-distro pill: a real button, in the theme pill's
 * treatment, wearing agent-distro's mark — the profile, a dimmer short hash, and
 * a tooltip that names agent-distro, the profile, the exact bundle and what a
 * click does. The click is the caller's (the tile chrome opens Settings).
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({ tips: [] as string[] }));

vi.mock("../settings/useTips", () => ({
  useTips: () => ({
    showTipOnce: (tip: { id: string }) => bag.tips.push(tip.id),
  }),
}));

const { default: AgentProfileChip, agentChipLabel } = await import(
  "./AgentProfileChip"
);

const BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  bag.tips = [];
});

function mount(onClick: (e: MouseEvent) => void = () => {}) {
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <AgentProfileChip
        profile="vanilla"
        bundle={BUNDLE}
        buttonClass="tile-button"
        onClick={onClick}
      />
    ),
    root,
  );
  const chip = root.querySelector<HTMLButtonElement>(
    '[data-testid="tile-agent-chip"]',
  );
  if (!chip) throw new Error("no chip rendered");
  return chip;
}

describe("AgentProfileChip", () => {
  it("is a button in the tile chrome's class, wearing the agent-distro mark", () => {
    const chip = mount();
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.className).toContain("tile-button");
    expect(
      chip.querySelector('[data-testid="agent-distro-logo"] svg'),
    ).not.toBeNull();
  });

  it("shows the profile, then the bundle's 8-character short hash", () => {
    const chip = mount();
    const spans = [...chip.querySelectorAll(":scope > span")].map(
      (s) => s.textContent,
    );
    // [logo, profile, hash]
    expect(spans.slice(1)).toEqual(["vanilla", "nd11nx5f"]);
  });

  it("names agent-distro, the profile, the full store path and the click", () => {
    const chip = mount();
    expect(agentChipLabel("vanilla", BUNDLE)).toBe(
      `agent-distro · vanilla · ${BUNDLE} — click to change for new terminals`,
    );
    expect(chip.getAttribute("aria-label")).toBe(
      agentChipLabel("vanilla", BUNDLE),
    );
  });

  it("hands its click to the caller (the tile chrome opens Settings)", () => {
    const onClick = vi.fn();
    const chip = mount(onClick);
    chip.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("raises the one-shot agents tip when it first appears", () => {
    mount();
    expect(bag.tips).toEqual(["agents"]);
  });
});
