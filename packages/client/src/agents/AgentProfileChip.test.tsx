// @vitest-environment happy-dom
/**
 * The tile header's agent-distro pill: ONE button in the theme pill's
 * treatment, wearing agent-distro's mark — the profile and a dimmer short hash.
 *
 *  - current: a click is the caller's (the tile chrome opens Settings);
 *  - stale with nothing to restart into yet: dimmed, still opens Settings;
 *  - stale and restartable: the same pill grows "↻ Restart" and the WHOLE pill
 *    is the restart — a plain shell restarts on the first press; a live agent
 *    arms first (the armed text for 5 s), lapses, disarms when the agent goes
 *    quiet; a restart in flight disables the pill, so a double click is one.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentChipLabel,
  agentRestartAction,
  type AgentStaleness,
} from "@kolu/agent-distro/status";
import type { ChipRestart } from "./AgentProfileChip";
import { RESTART_ARM_MS } from "./restartGuard";

const bag = vi.hoisted(() => ({ tips: [] as string[] }));

vi.mock("../settings/useTips", () => ({
  useTips: () => ({
    showTipOnce: (tip: { id: string }) => bag.tips.push(tip.id),
  }),
}));

const { default: AgentProfileChip } = await import("./AgentProfileChip");

const BUNDLE =
  "/nix/store/nd11nx5f1dkf02cr9dhxqq4axg23vzgc-agent-distro-vanilla";
const STALE: AgentStaleness = {
  kind: "stale",
  had: { profile: "vanilla", hash: "nd11nx5f" },
  now: { kind: "profile", profile: "juspay", hash: "ivzki9f3" },
};

/** The action for a stale terminal whose agents stay on. */
const RESTART_AGENT = agentRestartAction(STALE);

let dispose: (() => void) | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  bag.tips = [];
  vi.useRealTimers();
});

function mount(opts: {
  onClick?: (e: MouseEvent) => void;
  staleness?: AgentStaleness;
  restart?: ChipRestart;
  guarded?: boolean;
}) {
  const [guarded, setGuarded] = createSignal(opts.guarded ?? false);
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <AgentProfileChip
        profile="vanilla"
        bundle={BUNDLE}
        buttonClass="tile-button"
        onClick={opts.onClick ?? (() => {})}
        staleness={opts.staleness}
        restart={
          opts.restart === undefined
            ? undefined
            : { ...opts.restart, guarded: guarded() }
        }
      />
    ),
    root,
  );
  const chip = root.querySelector<HTMLButtonElement>(
    '[data-testid="tile-agent-chip"]',
  );
  if (!chip) throw new Error("no chip rendered");
  const action = () =>
    chip.querySelector('[data-testid="tile-agent-restart"]')?.textContent;
  return { chip, action, setGuarded };
}

function restartable(run = vi.fn(() => Promise.resolve())) {
  return {
    run,
    restart: { guarded: false, action: RESTART_AGENT, run },
  };
}

describe("AgentProfileChip — current", () => {
  it("is a button in the tile chrome's class, wearing the agent-distro mark", () => {
    const { chip } = mount({});
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.className).toContain("tile-button");
    expect(
      chip.querySelector('[data-testid="agent-distro-logo"] svg'),
    ).not.toBeNull();
  });

  it("shows the profile, then the bundle's 8-character short hash, and no action", () => {
    const { chip, action } = mount({});
    const spans = [...chip.querySelectorAll(":scope > span")].map(
      (s) => s.textContent,
    );
    expect(spans.slice(1)).toEqual(["vanilla", "nd11nx5f"]);
    expect(action()).toBeUndefined();
  });

  it("says what the terminal got and what a click does; the store path is in the accessible name only", () => {
    const { chip } = mount({});
    expect(agentChipLabel("vanilla", BUNDLE)).toBe(
      "This terminal started with the vanilla coding agents (nd11nx5f). Click to choose what new terminals get.",
    );
    expect(chip.getAttribute("aria-label")).toBe(
      `${agentChipLabel("vanilla", BUNDLE)} Bundle: ${BUNDLE}`,
    );
  });

  it("hands its click to the caller (the tile chrome opens Settings)", () => {
    const onClick = vi.fn();
    const { chip } = mount({ onClick });
    chip.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("raises the one-shot agents tip when it first appears", () => {
    mount({});
    expect(bag.tips).toEqual(["agents"]);
  });
});

describe("AgentProfileChip — stale", () => {
  it("nothing to restart into yet: dimmed, no strikethrough, no action, still opens Settings", () => {
    const onClick = vi.fn();
    const { chip, action } = mount({ onClick, staleness: STALE });
    expect(chip.hasAttribute("data-stale")).toBe(true);
    expect(chip.hasAttribute("data-restart")).toBe(false);
    expect(chip.innerHTML).not.toContain("line-through");
    expect(action()).toBeUndefined();
    chip.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("restartable: the whole pill is the restart — a plain shell restarts on the first press", () => {
    const onClick = vi.fn();
    const { run, restart } = restartable();
    const { chip, action } = mount({ onClick, staleness: STALE, restart });
    expect(action()).toBe("↻ Restart");
    chip.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a live agent: the first press arms with the caller's text, the second restarts", () => {
    const { run, restart } = restartable();
    const { chip, action } = mount({
      staleness: STALE,
      restart,
      guarded: true,
    });
    chip.click();
    expect(run).not.toHaveBeenCalled();
    expect(action()).toBe("↻ Restart agent");
    expect(chip.hasAttribute("data-armed")).toBe(true);
    chip.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("an armed pill lapses after 5 s, and the next press only arms again", () => {
    const { run, restart } = restartable();
    const { chip, action } = mount({
      staleness: STALE,
      restart,
      guarded: true,
    });
    chip.click();
    vi.advanceTimersByTime(RESTART_ARM_MS - 1);
    expect(action()).toBe("↻ Restart agent");
    vi.advanceTimersByTime(1);
    expect(action()).toBe("↻ Restart");
    chip.click();
    expect(run).not.toHaveBeenCalled();
  });

  it("the agent going quiet while armed disarms it", () => {
    const { restart } = restartable();
    const { chip, action, setGuarded } = mount({
      staleness: STALE,
      restart,
      guarded: true,
    });
    chip.click();
    setGuarded(false);
    expect(action()).toBe("↻ Restart");
    expect(chip.hasAttribute("data-armed")).toBe(false);
  });

  it("in flight: the pill is disabled and dimmed, so a double click is one restart", async () => {
    let settle!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          settle = r;
        }),
    );
    const { chip } = mount({
      staleness: STALE,
      restart: { guarded: false, action: RESTART_AGENT, run },
    });
    chip.click();
    chip.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(chip.disabled).toBe(true);
    expect(chip.className).toContain("opacity-50");
    settle();
    await vi.waitFor(() => expect(chip.disabled).toBe(false));
  });
});
