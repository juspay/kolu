// @vitest-environment happy-dom
/**
 * The host dropdown's forward row — one of the two surfaces the human reported
 * twice, and for two different reasons.
 *
 * First it had no link at all. Then it had one on the port NUMBER, which the
 * field verdict rejected as invisible: a dotted underline at 40% opacity reads
 * as plain text. Both cuts made the same mistake — spending the affordance on
 * chrome (a bare `↗`, then a rule under a digit) rather than on the ANSWER.
 *
 * The row now NAMES the terminal serving the port, and that name is the link.
 * The number goes back to being what it always was: the row's subject, in plain
 * mono type.
 */

import type { KoluForward } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./useForwards", () => ({ cancelForward: () => Promise.resolve() }));

const { ForwardRow } = await import("./ForwardRows");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

const forward: KoluForward = {
  key: "remote:naiveintent:5173",
  host: { kind: "remote", target: "naiveintent" },
  remotePort: 5173,
  localPort: 5173,
  origin: "auto",
  createdAt: 0,
};

function mount(serving?: { name: string; jump: () => void }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <ForwardRow forward={forward} serving={serving} />,
    host,
  );
  return host;
}

describe("ForwardRow — the dropdown surface", () => {
  it("names the serving terminal, and the name is the link", () => {
    const jump = vi.fn();
    const el = mount({ name: "kolu/master", jump });
    const link = el.querySelector<HTMLButtonElement>(
      '[data-testid="terminal-jump"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBe("kolu/master");
    link?.click();
    expect(jump).toHaveBeenCalledOnce();
  });

  it("the link is visibly a link at rest, not styled like the row's text", () => {
    const el = mount({ name: "kolu/master", jump: vi.fn() });
    const cls =
      el.querySelector('[data-testid="terminal-jump"]')?.className ?? "";
    expect(cls).toMatch(/(^|\s)text-accent(\s|$)/);
    expect(cls).toMatch(/(^|\s)underline(\s|$)/);
  });

  it("says nothing rather than lying when no terminal is attributed", () => {
    // A ⌘K forward to a port nothing serves, or one whose server has died. The
    // row stays — its door is real and cancellable — but it must not offer a
    // click that goes nowhere, and it must not invent a name.
    const el = mount(undefined);
    expect(el.querySelector('[data-testid="terminal-jump"]')).toBeNull();
    expect(el.textContent).toContain("5173");
  });

  it("leaves the port NUMBER as plain text — no secret click target", () => {
    // The number carried the link in the rejected cut. Keeping it clickable but
    // unmarked would be the same defect wearing a smaller hat: an affordance
    // only someone who already knew about it could find.
    const el = mount({ name: "kolu/master", jump: vi.fn() });
    expect(el.querySelector('[data-testid="port-jump"]')).toBeNull();
  });
});
