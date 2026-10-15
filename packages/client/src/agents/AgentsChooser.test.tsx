// @vitest-environment happy-dom
/**
 * The Agents choice, through its one writer:
 *
 *  - Settings' list writes each edit at once — the WHOLE list — and never
 *    touches the switch; a reference it adds is remembered for the field's
 *    suggestions;
 *  - the welcome step's list is held, written only by "Turn on" (agents on
 *    with it). It rides one cell with every other preference, so the danger
 *    is a write that has nothing to do with agents — a tip dismissed, the
 *    colour scheme flipped — throwing away the list being put together; a
 *    move of the stored Agents setting itself puts it back.
 */

import type { AgentDistroSetting } from "@kolu/agent-distro/schema";
import type { AgentDistroListing } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentsChooser, { type AgentsChooserParts } from "./AgentsChooser";

interface TestPrefs {
  readonly agentDistro: AgentDistroSetting | null;
  readonly agentProfilesRecent: readonly string[];
  readonly seenTips?: readonly string[];
}

const h = vi.hoisted(() => ({
  prefs: undefined as (() => TestPrefs) | undefined,
  setPrefs: undefined as ((next: TestPrefs) => void) | undefined,
  writes: [] as unknown[],
}));

// `vi.mock`'s factory runs BEFORE this module's imports, so solid-js can only
// be reached from inside it.
vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [prefs, setPrefs] = createSignal<TestPrefs>({
    agentDistro: null,
    agentProfilesRecent: [],
  });
  h.prefs = prefs;
  h.setPrefs = setPrefs;
  return {
    preferences: prefs,
    updatePreferences: (patch: Partial<TestPrefs>) => {
      h.writes.push(patch);
      setPrefs({ ...prefs(), ...patch });
    },
  };
});

const NEVER: AgentDistroSetting = { enabled: false, profiles: [] };

// The live facts this row reads: the package, nothing resolved yet.
vi.mock("./useAgentDistro", () => ({
  agentDistroListing: (): AgentDistroListing => ({
    kind: "available",
    harnesses: [{ name: "claude", title: "Claude Code", version: "1" }],
  }),
  agentDistroStored: (): AgentDistroSetting | null =>
    h.prefs?.().agentDistro ?? null,
  agentDistroSetting: (): AgentDistroSetting =>
    h.prefs?.().agentDistro ?? NEVER,
  agentFleetNow: () => [],
  agentProfilesNow: () => undefined,
  localAgentReceipt: () => undefined,
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  h.writes = [];
});

/** Write the one preferences cell the way another surface would. */
function writePrefs(patch: Partial<TestPrefs>): void {
  const prefs = h.prefs?.();
  if (prefs === undefined || h.setPrefs === undefined)
    throw new Error("the wire mock did not install its preferences cell");
  h.setPrefs({ ...prefs, ...patch });
}

function mount(deferred: boolean) {
  let parts: AgentsChooserParts | undefined;
  dispose = render(
    () => (
      <AgentsChooser deferred={deferred}>
        {(p) => {
          parts = p;
          return p.profiles;
        }}
      </AgentsChooser>
    ),
    document.body,
  );
  const q = <T extends Element>(sel: string) =>
    document.querySelector<T>(sel) ?? undefined;
  return {
    parts: () => {
      if (parts === undefined) throw new Error("no parts");
      return parts;
    },
    rows: () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid=agents-profile-row]",
        ),
      ].map((r) => r.dataset.reference),
    juspay: () => q<HTMLButtonElement>("[data-testid=agents-add-juspay]"),
    input: () => q<HTMLInputElement>("[data-testid=agents-profile-input]"),
    remove: (i: number) =>
      document
        .querySelectorAll<HTMLButtonElement>(
          "[data-testid=agents-profile-remove]",
        )
        [i]?.click(),
    up: (i: number) =>
      document
        .querySelectorAll<HTMLButtonElement>("[data-testid=agents-profile-up]")
        [i]?.click(),
  };
}

describe("Settings' list", () => {
  it("is absent while agents are off", () => {
    writePrefs({ agentDistro: { enabled: false, profiles: [] } });
    const ui = mount(false);
    expect(document.querySelector("[data-testid=agents-profiles]")).toBeNull();
    expect(ui.juspay()).toBeUndefined();
  });

  it("each edit writes the whole list at once, the switch untouched", () => {
    writePrefs({ agentDistro: { enabled: true, profiles: [] } });
    const ui = mount(false);
    ui.juspay()?.click();
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills"],
    });
    // The one-click entry goes once the list holds it.
    expect(ui.juspay()).toBeUndefined();

    const input = ui.input();
    if (input === undefined) throw new Error("no add field");
    input.value = "~/my-profile";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills", "~/my-profile"],
    });
    // Remembered for the field's suggestions — Juspay has its own entry.
    expect(h.prefs?.().agentProfilesRecent).toEqual(["~/my-profile"]);
    expect(input.value).toBe("");

    ui.up(1);
    expect(h.prefs?.().agentDistro?.profiles).toEqual([
      "~/my-profile",
      "github:juspay/skills",
    ]);
    ui.remove(0);
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills"],
    });
    expect(ui.rows()).toEqual(["github:juspay/skills"]);
  });

  it("adding what the list already holds writes nothing", () => {
    writePrefs({
      agentDistro: { enabled: true, profiles: ["github:me/p"] },
    });
    const ui = mount(false);
    const input = ui.input();
    if (input === undefined) throw new Error("no add field");
    input.value = " github:me/p ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(h.writes).toEqual([]);
  });
});

describe("the welcome step's held list", () => {
  it("writes nothing until Turn on, then agents on with the list", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    // No field of your own on the first run: the one-click entry only.
    expect(ui.input()).toBeUndefined();
    ui.juspay()?.click();
    expect(ui.rows()).toEqual(["github:juspay/skills"]);
    expect(h.writes).toEqual([]);
    expect(h.prefs?.().agentDistro).toBeNull();

    ui.parts().turnOn();
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills"],
    });
  });

  it("Turn on with an empty list is the agents as they ship", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    expect(ui.parts().canTurnOn()).toBe(true);
    ui.parts().turnOn();
    expect(h.prefs?.().agentDistro).toEqual({ enabled: true, profiles: [] });
  });

  it("survives a write to an unrelated preference", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    ui.juspay()?.click();
    writePrefs({ seenTips: ["agents"] });
    expect(ui.rows()).toEqual(["github:juspay/skills"]);
  });

  it("is put back when the stored Agents setting itself moves", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    ui.juspay()?.click();
    writePrefs({
      agentDistro: { enabled: false, profiles: ["github:me/p"] },
    });
    expect(ui.rows()).toEqual(["github:me/p"]);
  });
});
