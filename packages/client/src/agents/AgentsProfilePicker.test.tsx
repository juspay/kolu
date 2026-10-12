// @vitest-environment happy-dom
/**
 * The Agents profile picker: one radio card per profile, the picked one
 * checked, a pick handed to the caller — and, under the picked Custom… card,
 * the reference field. Its text is the stored profile until edited, Enter and
 * a picked suggestion (the chevron's menu, filtered by typing, moved with the
 * arrows, or clicked) hand the value to the caller, blur and Escape put the
 * stored profile back, and the line under it wears the resolved line's three
 * states — pending, resolved, failed (red, with what it means for new
 * terminals).
 */

import {
  AGENTS_CUSTOM,
  AGENTS_UNRESOLVED_MEANS,
  type AgentProfileCard,
  type AgentsResolvedLine,
} from "@kolu/agent-distro/status";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import AgentsProfilePicker from "./AgentsProfilePicker";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const CARDS: readonly AgentProfileCard[] = [
  {
    profile: "vanilla",
    title: "Vanilla",
    description: "Upstream harnesses with your own provider",
    isDefault: true,
  },
  {
    profile: "github:juspay/skills",
    title: "Juspay",
    description: "Juspay skills + Kolu",
    reference: "github:juspay/skills",
    isDefault: false,
  },
  {
    profile: undefined,
    title: AGENTS_CUSTOM.title,
    description: AGENTS_CUSTOM.description,
    isDefault: false,
  },
];

function mount(options?: {
  resolved?: AgentsResolvedLine;
  selected?: string | undefined | "custom";
}) {
  const picked: (string | undefined)[] = [];
  const submitted: string[] = [];
  const [line, setLine] = createSignal(options?.resolved);
  const [profile, setProfile] = createSignal("github:juspay/skills");
  const key = options?.selected ?? "vanilla";
  const [selected, setSelected] = createSignal<AgentProfileCard | undefined>(
    CARDS.find((c) => (c.profile ?? "custom") === key),
  );
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <AgentsProfilePicker
        cards={CARDS}
        selected={selected()}
        onPick={(p) => {
          picked.push(p);
          setSelected(CARDS.find((c) => c.profile === p));
        }}
        profile={profile()}
        suggestions={[
          { value: "vanilla", note: "used before" },
          { value: "github:me/p", note: "used before" },
        ]}
        resolved={line()}
        onSubmit={(text) => submitted.push(text)}
        references
      />
    ),
    host,
  );
  const cards = () => [
    ...host.querySelectorAll<HTMLInputElement>(
      "[data-testid=agents-profile-card]",
    ),
  ];
  const input = () =>
    host.querySelector<HTMLInputElement>("[data-testid=agents-profile-input]");
  const resolvedEl = () =>
    host.querySelector<HTMLElement>("[data-testid=agents-resolved]");
  return {
    host,
    cards,
    input,
    picked,
    submitted,
    setLine,
    setProfile,
    resolvedEl,
  };
}

/** The open menu's rows (portalled to the body). */
function options(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "[data-testid=agents-profile-option]",
    ),
  ];
}

function key(input: HTMLInputElement, k: string): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

/** Typing, as the browser reports it: an `insertText` input event. */
function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText" }),
  );
}

describe("the cards", () => {
  it("one per profile, the picked one checked, the Default mark on the default", () => {
    const f = mount();
    expect(f.cards().map((c) => c.dataset.profile)).toEqual([
      "vanilla",
      "github:juspay/skills",
      "custom",
    ]);
    expect(f.cards().map((c) => c.checked)).toEqual([true, false, false]);
    expect(f.host.textContent).toContain("Default");
    // The reference sits under the name, not in place of it.
    expect(f.host.textContent).toContain("Juspay");
    expect(f.host.textContent).toContain("github:juspay/skills");
  });

  it("picking a card hands its profile to the caller; Custom… hands none", () => {
    const f = mount();
    f.cards()[1]?.click();
    expect(f.picked).toEqual(["github:juspay/skills"]);
    f.cards()[2]?.click();
    expect(f.picked).toEqual(["github:juspay/skills", undefined]);
  });

  it("the field shows only under the picked Custom… card", () => {
    const f = mount();
    expect(f.input()).toBeNull();
    f.cards()[2]?.click();
    expect(f.input()).not.toBeNull();
  });
});

describe("Custom…'s reference field", () => {
  function custom(resolved?: AgentsResolvedLine) {
    const f = mount({ selected: "custom", resolved });
    const input = f.input();
    if (input === null) throw new Error("no input");
    return { ...f, field: input };
  }

  it("shows the stored profile, and follows a write from elsewhere", () => {
    const f = custom();
    expect(f.field.value).toBe("github:juspay/skills");
    f.setProfile("github:me/mine");
    expect(f.field.value).toBe("github:me/mine");
  });

  it("Enter hands the text to the caller, as typed", () => {
    const f = custom();
    type(f.field, "github:nobody/nothing");
    key(f.field, "Enter");
    expect(f.submitted).toEqual(["github:nobody/nothing"]);
  });

  it("blur and Escape put the stored profile back, writing nothing", () => {
    const f = custom();
    type(f.field, "github:half-typ");
    f.field.dispatchEvent(new FocusEvent("blur"));
    expect(f.field.value).toBe("github:juspay/skills");
    type(f.field, "github:other");
    key(f.field, "Escape");
    expect(f.field.value).toBe("github:juspay/skills");
    expect(f.submitted).toEqual([]);
  });

  it("the chevron opens every suggestion, each value in mono with its note", () => {
    const f = custom();
    const chevron = f.host.querySelector<HTMLButtonElement>(
      "[data-testid=agents-profile-chevron]",
    );
    expect(chevron?.getAttribute("aria-expanded")).toBe("false");
    chevron?.click();
    expect(chevron?.getAttribute("aria-expanded")).toBe("true");
    expect(options().map((o) => o.dataset.value)).toEqual([
      "vanilla",
      "github:me/p",
    ]);
    expect(options()[0]?.textContent).toBe("vanillaused before");
  });

  it("typing filters the rows; ↓ then Enter picks one and writes it", () => {
    const f = custom();
    type(f.field, "me/");
    expect(options().map((o) => o.dataset.value)).toEqual(["github:me/p"]);
    key(f.field, "ArrowDown");
    expect(options()[0]?.dataset.active).toBe("");
    key(f.field, "Enter");
    expect(f.submitted).toEqual(["github:me/p"]);
    expect(options()).toEqual([]);
  });

  it("a click on a row picks it", () => {
    const f = custom();
    key(f.field, "ArrowDown");
    options()[1]?.click();
    expect(f.submitted).toEqual(["github:me/p"]);
    expect(f.field.value).toBe("github:me/p");
  });

  it("the resolved line's three states", () => {
    const f = custom({ kind: "pending", text: "resolving x…" });
    expect(f.resolvedEl()?.dataset.kind).toBe("pending");
    expect(f.resolvedEl()?.textContent).toBe("resolving x…");
    f.setLine({ kind: "resolved", text: "juspay · Juspay skills + Kolu" });
    expect(f.resolvedEl()?.dataset.kind).toBe("resolved");
    expect(f.resolvedEl()?.textContent).toBe("juspay · Juspay skills + Kolu");
    f.setLine({ kind: "failed", text: "cannot fetch x: HTTP error 404" });
    expect(f.resolvedEl()?.dataset.kind).toBe("failed");
    expect(f.resolvedEl()?.textContent).toBe(
      `cannot fetch x: HTTP error 404${AGENTS_UNRESOLVED_MEANS}`,
    );
    expect(f.field.getAttribute("class")).toContain("border-danger");
  });
});
