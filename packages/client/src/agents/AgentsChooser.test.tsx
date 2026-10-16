// @vitest-environment happy-dom
/**
 * The Agents choice, through its one writer:
 *
 *  - Settings' list writes each edit at once — the WHOLE list — and never
 *    touches the switch; a reference it adds is remembered for the field's
 *    suggestions;
 *  - the welcome step's list starts EMPTY whatever is stored — Juspay is
 *    never there unless its one-click row is pressed — and is held, written
 *    only by "Turn on"
 *    (agents on with it). A preference write elsewhere never throws away the
 *    list being put together.
 *
 *  Settings offers Juspay as its field's first suggestion; the welcome step
 *  as a visible one-click row above its list.
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
    input: () => q<HTMLInputElement>("[data-testid=agents-profile-input]"),
    juspay: () => q<HTMLButtonElement>("[data-testid=agents-add-juspay]"),
    /** The field's suggestions, as focusing it opens them. */
    suggested: () => {
      q<HTMLInputElement>("[data-testid=agents-profile-input]")?.focus();
      return [
        ...document.querySelectorAll<HTMLElement>(
          "[data-testid=agents-profile-option]",
        ),
      ];
    },
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
    expect(ui.input()).toBeUndefined();
  });

  it("offers Juspay as the field's first suggestion, not a one-click row", () => {
    writePrefs({ agentDistro: { enabled: true, profiles: [] } });
    const ui = mount(false);
    expect(ui.juspay()).toBeUndefined();
    expect(ui.suggested()[0]?.dataset.value).toBe("github:juspay/skills");
  });

  it("each edit writes the whole list at once, the switch untouched", () => {
    writePrefs({ agentDistro: { enabled: true, profiles: [] } });
    const ui = mount(false);
    const input = ui.input();
    if (input === undefined) throw new Error("no add field");
    ui.suggested()[0]?.click();
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills"],
    });
    // Juspay is no longer suggested once the list holds it.
    input.blur();
    expect(ui.suggested().map((o) => o.dataset.value)).not.toContain(
      "github:juspay/skills",
    );

    input.value = "~/my-profile";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(h.prefs?.().agentDistro).toEqual({
      enabled: true,
      profiles: ["github:juspay/skills", "~/my-profile"],
    });
    // Remembered for the field's suggestions — Juspay is always suggested.
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
  it("starts empty whatever is stored — a list kept from before agents went off included", () => {
    writePrefs({
      agentDistro: { enabled: false, profiles: ["github:juspay/skills"] },
    });
    const ui = mount(true);
    expect(ui.rows()).toEqual([]);
    // Offered, not chosen.
    expect(ui.juspay()).toBeDefined();
  });

  it("writes nothing until Turn on, then agents on with the list", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    // Juspay is the visible one-click row, not a suggestion in the field.
    expect(ui.suggested().map((o) => o.dataset.value)).not.toContain(
      "github:juspay/skills",
    );
    ui.juspay()?.click();
    expect(ui.rows()).toEqual(["github:juspay/skills"]);
    expect(ui.juspay()).toBeUndefined();
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

  it("survives a write to another preference", () => {
    writePrefs({ agentDistro: null });
    const ui = mount(true);
    ui.juspay()?.click();
    writePrefs({ seenTips: ["agents"] });
    writePrefs({ agentDistro: { enabled: false, profiles: ["github:me/p"] } });
    expect(ui.rows()).toEqual(["github:juspay/skills"]);
  });
});
