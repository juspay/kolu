// @vitest-environment happy-dom
/**
 * The Agents profile list: one row per profile in stack order — its title,
 * the reference beside it when they differ, and the resolved line's three
 * states — removed by its ✕ and, with two rows or more, moved by its arrows,
 * the WHOLE next list handed to the caller; an empty list draws no rows; and
 * the one read-only row a repository's agent-distro.nix makes, always last.
 * Below: the add field, whose menu of suggestions — Juspay's first — opens
 * on focus or from the chevron, filters as you type, and adds on Enter or a
 * click. With `prominentJuspay` (the welcome step) Juspay is instead a
 * visible one-click row above the list, gone once it is listed.
 */

import {
  AGENTS_UNRESOLVED_MEANS,
  type AgentsResolvedLine,
  JUSPAY_PROFILE,
  type ProfileSuggestion,
} from "@kolu/agent-distro/status";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import AgentsProfileList, { type ProfileListRow } from "./AgentsProfileList";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const SUGGESTIONS: readonly ProfileSuggestion[] = [
  { value: JUSPAY_PROFILE, title: "Juspay", note: "Juspay skills + Kolu" },
  { value: "github:me/p", note: "used before" },
  { value: "~/work/profile", note: "used before" },
];

function mount(
  initial: readonly ProfileListRow[],
  opts: { prominentJuspay?: boolean } = {},
) {
  const [rows, setRows] = createSignal(initial);
  const changes: (readonly string[])[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <AgentsProfileList
        rows={rows()}
        suggestions={SUGGESTIONS}
        prominentJuspay={opts.prominentJuspay}
        onChange={(next) => {
          changes.push(next);
          // As the caller's write comes back: the rows follow the list.
          setRows(
            next.map(
              (reference) =>
                rows().find((r) => r.reference === reference) ?? {
                  reference,
                  title: reference,
                },
            ),
          );
        }}
      />
    ),
    host,
  );
  const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
  const input = () =>
    host.querySelector<HTMLInputElement>("[data-testid=agents-profile-input]");
  return {
    host,
    changes,
    setRows,
    input,
    rows: () =>
      all("[data-testid=agents-profile-row]").map((r) => r.dataset.reference),
    button: (name: "up" | "down" | "remove", i: number) =>
      all(`[data-testid=agents-profile-${name}]`)[i] as
        | HTMLButtonElement
        | undefined,
  };
}

const row = (reference: string, line?: AgentsResolvedLine): ProfileListRow => ({
  reference,
  title: reference === JUSPAY_PROFILE ? "Juspay" : reference,
  line,
});

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

describe("the rows", () => {
  it("empty: no rows — only the repository's row, then the add field", () => {
    const f = mount([]);
    expect(f.rows()).toEqual([]);
    const items = [...f.host.querySelectorAll("ol > li")];
    expect(items.map((li) => li.getAttribute("data-testid"))).toEqual([
      "agents-profile-repo",
    ]);
    expect(f.input()).not.toBeNull();
    // The stacking rule is said once, in the repository's row.
    expect(f.host.querySelectorAll("p")).toHaveLength(0);
  });

  it("one row: its ✕, and no arrows — order means nothing yet", () => {
    const f = mount([row("a")]);
    expect(f.button("up", 0)).toBeUndefined();
    expect(f.button("down", 0)).toBeUndefined();
    expect(f.button("remove", 0)).toBeDefined();
  });

  it("one per profile in stack order, the reference beside a title that differs from it", () => {
    const f = mount([row(JUSPAY_PROFILE), row("~/mine")]);
    expect(f.rows()).toEqual([JUSPAY_PROFILE, "~/mine"]);
    const first = f.host.querySelector("[data-testid=agents-profile-row]");
    expect(first?.textContent).toContain("Juspay");
    expect(first?.textContent).toContain(JUSPAY_PROFILE);
  });

  it("the repository's row is last, read-only, and links to the docs", () => {
    const f = mount([row("~/mine")]);
    const repo = f.host.querySelector("[data-testid=agents-profile-repo]");
    expect(repo?.textContent).toContain("agent-distro.nix");
    expect(repo?.querySelector("button")).toBeNull();
    expect(repo?.querySelector("a")?.getAttribute("href")).toBe(
      "https://kolu.dev/agents/#how-profiles-stack",
    );
  });

  it("move up/down hand the whole reordered list; the ends are disabled", () => {
    const f = mount([row("a"), row("b"), row("c")]);
    expect(f.button("up", 0)?.disabled).toBe(true);
    expect(f.button("down", 2)?.disabled).toBe(true);
    f.button("down", 0)?.click();
    expect(f.changes).toEqual([["b", "a", "c"]]);
    f.button("up", 2)?.click();
    expect(f.changes.at(-1)).toEqual(["b", "c", "a"]);
  });

  it("the focus stays on the moved row", async () => {
    const f = mount([row("a"), row("b"), row("c")]);
    f.button("down", 0)?.focus();
    f.button("down", 0)?.click();
    await Promise.resolve();
    expect(
      (document.activeElement as HTMLElement | null)?.closest("li")?.dataset
        .reference,
    ).toBe("a");
  });

  it("remove hands the list without it", () => {
    const f = mount([row("a"), row("b")]);
    f.button("remove", 0)?.click();
    expect(f.changes).toEqual([["b"]]);
    expect(f.rows()).toEqual(["b"]);
  });

  it("the resolved line's three states", () => {
    const f = mount([row("x", { kind: "pending", text: "resolving x…" })]);
    const line = () =>
      f.host.querySelector<HTMLElement>("[data-testid=agents-resolved]");
    expect(line()?.dataset.kind).toBe("pending");
    expect(line()?.textContent).toBe("resolving x…");
    f.setRows([
      row("x", { kind: "resolved", text: "juspay · Juspay skills + Kolu" }),
    ]);
    expect(line()?.dataset.kind).toBe("resolved");
    f.setRows([
      row("x", { kind: "failed", text: "cannot fetch x: HTTP error 404" }),
    ]);
    expect(line()?.dataset.kind).toBe("failed");
    expect(line()?.textContent).toBe(
      `cannot fetch x: HTTP error 404${AGENTS_UNRESOLVED_MEANS}`,
    );
  });
});

describe("adding", () => {
  it("focusing the field opens its suggestions, Juspay's first", () => {
    const f = mount([]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    input.focus();
    expect(options().map((o) => o.dataset.value)).toEqual([
      JUSPAY_PROFILE,
      "github:me/p",
      "~/work/profile",
    ]);
    expect(options()[0]?.textContent).toBe("+ JuspayJuspay skills + Kolu");
  });

  it("no one-click Juspay row unless asked for (Settings)", () => {
    const f = mount([]);
    expect(f.host.querySelector("[data-testid=agents-add-juspay]")).toBeNull();
  });

  it("prominent: Juspay is a one-click row above the list, not in the field's menu, gone once listed", () => {
    const f = mount([row("~/mine")], { prominentJuspay: true });
    const juspay = () =>
      f.host.querySelector<HTMLButtonElement>(
        "[data-testid=agents-add-juspay]",
      );
    // Above the list.
    expect(
      f.host.querySelector("[data-testid=agents-profiles]")?.firstElementChild,
    ).toBe(juspay());
    f.input()?.focus();
    expect(options().map((o) => o.dataset.value)).toEqual([
      "github:me/p",
      "~/work/profile",
    ]);
    juspay()?.click();
    expect(f.changes).toEqual([["~/mine", JUSPAY_PROFILE]]);
    expect(juspay()).toBeNull();
  });

  it("picking Juspay's suggestion appends it", () => {
    const f = mount([row("~/mine")]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    input.focus();
    options()[0]?.click();
    expect(f.changes).toEqual([["~/mine", JUSPAY_PROFILE]]);
  });

  it("Enter appends the text, trimmed, and empties the field", () => {
    const f = mount([row("a")]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    type(input, "  github:nobody/nothing ");
    key(input, "Enter");
    expect(f.changes).toEqual([["a", "github:nobody/nothing"]]);
    expect(input.value).toBe("");
  });

  it("an empty field or a repeat adds nothing", () => {
    const f = mount([row("a")]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    key(input, "Enter");
    type(input, "a");
    key(input, "Escape");
    key(input, "Enter");
    expect(f.changes).toEqual([]);
  });

  it("the chevron opens every suggestion, each value in mono with its note", () => {
    const f = mount([]);
    const chevron = f.host.querySelector<HTMLButtonElement>(
      "[data-testid=agents-profile-chevron]",
    );
    expect(chevron?.getAttribute("aria-expanded")).toBe("false");
    chevron?.click();
    expect(chevron?.getAttribute("aria-expanded")).toBe("true");
    expect(options().map((o) => o.dataset.value)).toEqual([
      JUSPAY_PROFILE,
      "github:me/p",
      "~/work/profile",
    ]);
    expect(options()[1]?.textContent).toBe("github:me/pused before");
  });

  it("typing filters the rows; ↓ then Enter adds one", () => {
    const f = mount([]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    type(input, "work");
    expect(options().map((o) => o.dataset.value)).toEqual(["~/work/profile"]);
    key(input, "ArrowDown");
    expect(options()[0]?.dataset.active).toBe("");
    key(input, "Enter");
    expect(f.changes).toEqual([["~/work/profile"]]);
    expect(options()).toEqual([]);
  });

  it("a click on a row adds it", () => {
    const f = mount([]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    key(input, "ArrowDown");
    options()[1]?.click();
    expect(f.changes).toEqual([["github:me/p"]]);
  });

  it("Escape closes the menu first, then empties the field — adding nothing", () => {
    const f = mount([]);
    const input = f.input();
    if (input === null) throw new Error("no input");
    type(input, "github:half");
    key(input, "Escape");
    expect(options()).toEqual([]);
    expect(input.value).toBe("github:half");
    key(input, "Escape");
    expect(input.value).toBe("");
    expect(f.changes).toEqual([]);
  });
});
