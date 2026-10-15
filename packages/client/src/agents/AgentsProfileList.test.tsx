// @vitest-environment happy-dom
/**
 * The Agents profile list: one row per profile in stack order — its title,
 * the reference beside it when they differ, and the resolved line's three
 * states — each moved or removed by its own buttons, the WHOLE next list
 * handed to the caller; an empty list that says it is the agents as they
 * ship; and the one read-only row a repository's agent-distro.nix makes,
 * always last. Below: Juspay's one-click entry and the add field, whose
 * menu of earlier references opens from the chevron, filters as you type,
 * and adds on Enter or a click.
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
import AgentsProfileList, {
  AGENTS_NO_PROFILES,
  type ProfileListRow,
} from "./AgentsProfileList";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const SUGGESTIONS: readonly ProfileSuggestion[] = [
  { value: "github:me/p", note: "used before" },
  { value: "~/work/profile", note: "used before" },
];

function mount(
  initial: readonly ProfileListRow[],
  opts: { juspay?: boolean; field?: boolean } = {},
) {
  const [rows, setRows] = createSignal(initial);
  const changes: (readonly string[])[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <AgentsProfileList
        rows={rows()}
        juspay={opts.juspay ?? true}
        suggestions={opts.field === false ? undefined : SUGGESTIONS}
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
  it("empty: says it is the agents as they ship, and still ends with the repository's row", () => {
    const f = mount([]);
    expect(f.rows()).toEqual([]);
    expect(
      f.host.querySelector("[data-testid=agents-profiles-empty]")?.textContent,
    ).toBe(AGENTS_NO_PROFILES);
    const items = [...f.host.querySelectorAll("ol > li")];
    expect(items.at(-1)?.getAttribute("data-testid")).toBe(
      "agents-profile-repo",
    );
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
  it("Juspay's one-click entry appends it, when offered", () => {
    const f = mount([row("~/mine")]);
    f.host
      .querySelector<HTMLButtonElement>("[data-testid=agents-add-juspay]")
      ?.click();
    expect(f.changes).toEqual([["~/mine", JUSPAY_PROFILE]]);
    dispose?.();
    document.body.innerHTML = "";
    const g = mount([], { juspay: false });
    expect(g.host.querySelector("[data-testid=agents-add-juspay]")).toBeNull();
  });

  it("no field without suggestions to give it (the welcome step)", () => {
    const f = mount([], { field: false });
    expect(f.input()).toBeNull();
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
      "github:me/p",
      "~/work/profile",
    ]);
    expect(options()[0]?.textContent).toBe("github:me/pused before");
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
    options()[0]?.click();
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
