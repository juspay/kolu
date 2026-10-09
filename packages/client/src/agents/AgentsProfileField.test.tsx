// @vitest-environment happy-dom
/**
 * The Agents profile field: its text is the stored profile until edited,
 * Enter and blur hand the text to the caller, and the line under it wears the
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

describe("AgentsProfileField", () => {
  it("shows the stored profile, and follows a write from elsewhere", () => {
    const f = mount(undefined);
    expect(f.input.value).toBe("github:juspay/skills");
    f.setProfile("vanilla");
    expect(f.input.value).toBe("vanilla");
  });

  it("Enter and blur hand the text to the caller, as typed", () => {
    const f = mount(undefined);
    f.input.value = "github:nobody/nothing";
    f.input.dispatchEvent(new Event("input", { bubbles: true }));
    f.input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    f.input.dispatchEvent(new FocusEvent("blur"));
    expect(f.submitted).toEqual([
      "github:nobody/nothing",
      "github:nobody/nothing",
    ]);
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
      detail: AGENTS_UNRESOLVED_MEANS,
    });
    expect(f.resolvedEl()?.dataset.kind).toBe("failed");
    expect(f.resolvedEl()?.textContent).toBe(
      `cannot fetch x: HTTP error 404${AGENTS_UNRESOLVED_MEANS}`,
    );
    expect(f.input.getAttribute("class")).toContain("border-danger");
    expect(f.host.textContent).toContain("Claude Code 2.1.291");
  });
});
