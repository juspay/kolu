// @vitest-environment happy-dom
/**
 * The Agents profile field: its text is the stored profile until edited,
 * Enter and a picked suggestion hand the text to the caller, blur and Escape
 * put the stored profile back, and the line under it wears the
 * resolved line's three states — pending, resolved, failed (red, with what it
 * means for new terminals).
 */

import {
  AGENTS_UNRESOLVED_MEANS,
  type AgentsResolvedLine,
} from "@kolu/agent-distro/status";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import AgentsProfileField from "./AgentsProfileField";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

function mount(resolved: AgentsResolvedLine | undefined) {
  const submitted: string[] = [];
  const [line, setLine] = createSignal(resolved);
  const [profile, setProfile] = createSignal("github:juspay/skills");
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <AgentsProfileField
        profile={profile()}
        suggestions={[{ value: "vanilla", note: "stock" }]}
        resolved={line()}
        notes={["Claude Code 2.1.291"]}
        onSubmit={(text) => submitted.push(text)}
      />
    ),
    host,
  );
  const input = host.querySelector<HTMLInputElement>(
    "[data-testid=agents-profile-input]",
  );
  if (input === null) throw new Error("no input");
  const resolvedEl = () =>
    host.querySelector<HTMLElement>("[data-testid=agents-resolved]");
  return { host, input, submitted, setLine, setProfile, resolvedEl };
}

/** Typing, as the browser reports it: an `insertText` input event. */
function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText" }),
  );
}

describe("AgentsProfileField", () => {
  it("shows the stored profile, and follows a write from elsewhere", () => {
    const f = mount(undefined);
    expect(f.input.value).toBe("github:juspay/skills");
    f.setProfile("vanilla");
    expect(f.input.value).toBe("vanilla");
  });

  it("Enter hands the text to the caller, as typed", () => {
    const f = mount(undefined);
    type(f.input, "github:nobody/nothing");
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(f.submitted).toEqual(["github:nobody/nothing"]);
  });

  it("blur and Escape put the stored profile back, writing nothing", () => {
    const f = mount(undefined);
    type(f.input, "github:half-typ");
    f.input.dispatchEvent(new FocusEvent("blur"));
    expect(f.input.value).toBe("github:juspay/skills");
    type(f.input, "github:other");
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(f.input.value).toBe("github:juspay/skills");
    expect(f.submitted).toEqual([]);
  });

  it("a suggestion picked from the list writes at once", () => {
    const f = mount(undefined);
    f.input.value = "vanilla";
    f.input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
      }),
    );
    expect(f.submitted).toEqual(["vanilla"]);
  });

  it("the resolved line's three states", () => {
    const f = mount({ kind: "pending", text: "resolving x…" });
    expect(f.resolvedEl()?.dataset.kind).toBe("pending");
    expect(f.resolvedEl()?.textContent).toBe("resolving x…");
    f.setLine({ kind: "resolved", text: "juspay · Juspay skills + Kolu" });
    expect(f.resolvedEl()?.dataset.kind).toBe("resolved");
    expect(f.resolvedEl()?.textContent).toBe("juspay · Juspay skills + Kolu");
    f.setLine({
      kind: "failed",
      text: "cannot fetch x: HTTP error 404",
    });
    expect(f.resolvedEl()?.dataset.kind).toBe("failed");
    expect(f.resolvedEl()?.textContent).toBe(
      `cannot fetch x: HTTP error 404${AGENTS_UNRESOLVED_MEANS}`,
    );
    expect(f.input.getAttribute("class")).toContain("border-danger");
    expect(f.host.textContent).toContain("Claude Code 2.1.291");
  });
});
