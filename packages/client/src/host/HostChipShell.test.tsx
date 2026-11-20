// @vitest-environment happy-dom
import type { HostKey } from "kolu-common/hostKey";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostChipShell } from "./HostChipShell";

vi.mock("../useServerIdentity", () => ({
  useServerIdentity: () => ({
    appTitle: () => "kolu",
    hostname: () => "wavelet",
    themeColor: () => undefined,
  }),
}));

const REMOTE: HostKey = { kind: "remote", target: "srid@zest" };

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

function mount(state: () => { active: boolean; down: boolean }) {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <HostChipShell
        host={REMOTE}
        active={state().active}
        down={state().down}
        tab={{ style: { "--host-hue": "200" } }}
        select={{ "data-testid": "host-select" }}
        diagnostics={{ "data-testid": "host-diagnostics-open" }}
        attention={null}
      />
    ),
    root,
  );
  return root;
}

const tabOf = (el: HTMLElement): HTMLElement => {
  const tab = el.querySelector<HTMLElement>(".host-tab");
  if (!tab) throw new Error("no host tab rendered");
  return tab;
};
const selectOf = (el: HTMLElement): HTMLElement => {
  const btn = el.querySelector<HTMLElement>('[data-testid="host-select"]');
  if (!btn) throw new Error("no host select button rendered");
  return btn;
};

describe("HostChipShell — one class authority per element", () => {
  it("lights the ACTIVE tab on FIRST paint (the #2263 reload regression)", () => {
    const el = mount(() => ({ active: true, down: false }));
    const tab = tabOf(el);
    expect(tab.classList.contains("host-tab-active")).toBe(true);
    expect(tab.classList.contains("host-tab-idle")).toBe(false);
    expect(tab.classList.contains("host-tab")).toBe(true);
    expect(tab.classList.contains("relative")).toBe(true);
  });

  it("gives the ACTIVE label its text tone on first paint", () => {
    const el = mount(() => ({ active: true, down: false }));
    const select = selectOf(el);
    expect(select.classList.contains("text-fg")).toBe(true);
    expect(select.classList.contains("text-fg-2")).toBe(false);
    expect(select.classList.contains("cursor-pointer")).toBe(true);
  });

  it("paints an INACTIVE tab idle, with the quiet label tone", () => {
    const el = mount(() => ({ active: false, down: false }));
    expect(tabOf(el).classList.contains("host-tab-idle")).toBe(true);
    expect(tabOf(el).classList.contains("host-tab-active")).toBe(false);
    const select = selectOf(el);
    expect(select.classList.contains("text-fg-2")).toBe(true);
    expect(select.classList.contains("hover:text-fg")).toBe(true);
  });

  it("dims a DOWN tab at mount — never idle, label at the faintest tone", () => {
    const el = mount(() => ({ active: false, down: true }));
    const tab = tabOf(el);
    expect(tab.classList.contains("host-tab-down")).toBe(true);
    expect(tab.classList.contains("host-tab-idle")).toBe(false);
    expect(selectOf(el).classList.contains("text-fg-3")).toBe(true);
  });

  it("keeps the active belly on a DOWN host that owns the canvas", () => {
    const tab = tabOf(mount(() => ({ active: true, down: true })));
    expect(tab.classList.contains("host-tab-active")).toBe(true);
    expect(tab.classList.contains("host-tab-down")).toBe(true);
    expect(tab.classList.contains("host-tab-idle")).toBe(false);
  });

  it("MOVES the lit state when the active host changes", () => {
    const [active, setActive] = createSignal(true);
    const el = mount(() => ({ active: active(), down: false }));
    expect(tabOf(el).classList.contains("host-tab-active")).toBe(true);
    setActive(false);
    expect(tabOf(el).classList.contains("host-tab-active")).toBe(false);
    expect(tabOf(el).classList.contains("host-tab-idle")).toBe(true);
    expect(selectOf(el).classList.contains("text-fg-2")).toBe(true);
    setActive(true);
    expect(tabOf(el).classList.contains("host-tab-active")).toBe(true);
    expect(tabOf(el).classList.contains("host-tab-idle")).toBe(false);
    expect(selectOf(el).classList.contains("text-fg")).toBe(true);
  });
});
