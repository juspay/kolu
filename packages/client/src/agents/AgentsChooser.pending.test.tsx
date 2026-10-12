// @vitest-environment happy-dom
/**
 * The picked-but-unwritten card (Custom…'s field open, or a deferred pick on
 * the welcome step) survives until the stored AGENTS setting moves.
 *
 * It rides one cell with every other preference, so the danger is a write
 * that has nothing to do with agents — a tip dismissed, the colour scheme
 * flipped — dropping the pick: Custom…'s field would close mid-typing, and
 * the welcome step's highlight would snap back to the default card before
 * Enter.
 */

import type { AgentDistroSetting } from "@kolu/agent-distro/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentsChooser from "./AgentsChooser";

interface TestPrefs {
  readonly agentDistro: AgentDistroSetting | null;
  readonly agentProfilesRecent: readonly string[];
  readonly seenTips?: readonly string[];
}

const h = vi.hoisted(() => ({
  prefs: undefined as (() => TestPrefs) | undefined,
  setPrefs: undefined as ((next: TestPrefs) => void) | undefined,
}));

// `vi.mock`'s factory runs BEFORE this module's imports, so solid-js can only
// be reached from inside it.
vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [prefs, setPrefs] = createSignal<TestPrefs>({
    agentDistro: { enabled: true, profile: "vanilla" },
    agentProfilesRecent: [],
  });
  h.prefs = prefs;
  h.setPrefs = setPrefs;
  return {
    preferences: prefs,
    updatePreferences: (patch: Partial<TestPrefs>) =>
      setPrefs({ ...prefs(), ...patch }),
  };
});

// The live facts this row reads: ONE bundle, nothing downloading.
vi.mock("./useAgentDistro", () => ({
  agentDistroListing: (): AgentDistroListing => ({
    kind: "available",
    profiles: [
      {
        name: "vanilla",
        description: "Upstream harnesses with your own provider",
        harnesses: [],
      },
    ],
  }),
  agentDistroStored: (): AgentDistroSetting | null =>
    h.prefs?.().agentDistro ?? null,
  agentDistroSetting: (): AgentDistroSetting =>
    h.prefs?.().agentDistro ?? { enabled: false, profile: "vanilla" },
  agentFleetNow: () => [],
  localAgentReceipt: () => undefined,
  localAgentResolved: () => undefined,
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

/** Settings' row: the picker, Custom… included. */
function mount() {
  dispose = render(
    () => <AgentsChooser references>{(parts) => parts.picker}</AgentsChooser>,
    document.body,
  );
  return {
    pick: (profile: string) =>
      document
        .querySelector<HTMLInputElement>(
          `[data-testid="agents-profile-card"][data-profile="${profile}"]`,
        )
        ?.click(),
    picked: () =>
      document
        .querySelector("[data-testid='agents-profile-card'][data-selected]")
        ?.getAttribute("data-profile"),
    field: () => document.querySelector("[data-testid='agents-profile-input']"),
  };
}

/** Write the one preferences cell the way another surface would. */
function writePrefs(patch: Partial<TestPrefs>): void {
  const prefs = h.prefs?.();
  if (prefs === undefined || h.setPrefs === undefined)
    throw new Error("the wire mock did not install its preferences cell");
  h.setPrefs({ ...prefs, ...patch });
}

describe("a pick that is not written yet", () => {
  it("survives a write to an unrelated preference", () => {
    const ui = mount();
    ui.pick("custom");
    expect(ui.picked()).toBe("custom");
    expect(ui.field()).not.toBeNull();

    writePrefs({ seenTips: ["agents"] });

    expect(ui.picked()).toBe("custom");
    expect(ui.field()).not.toBeNull();
  });

  it("is dropped when the stored Agents setting itself moves", () => {
    const ui = mount();
    ui.pick("custom");
    expect(ui.picked()).toBe("custom");

    writePrefs({
      agentDistro: { enabled: true, profile: "github:juspay/skills" },
    });

    expect(ui.picked()).not.toBe("custom");
  });
});
