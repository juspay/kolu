// @vitest-environment happy-dom
/**
 * A host tab is LIT on first paint — the regression #2263 shipped and a reload
 * made visible.
 *
 * An element whose JSX spread carries `classList` beside a static `class` has
 * TWO class authorities, and Solid applies spread props in key order: the
 * `classList` state class lands first, `class` then runs as
 * `node.className = "…"` and erases it — and Solid remembers the class as
 * applied, so nothing re-adds it until the value flips false → true (the active
 * tab stayed unlit until you clicked a different host). So the shell takes
 * `active` / `down` as DATA and derives every element's classes in ONE `class`
 * expression, and its bag types forbid `class` / `classList` so a caller cannot
 * bring a second authority back through the spread.
 *
 * `../useServerIdentity` is mocked (the `HostIdentityLabel` inside the shell
 * reads the machine hostname off it) so the live socket stack never boots —
 * the `HostDownCanvas.test.tsx` idiom.
 */
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

/** Mount the shell the way `HostChip` does — state as data, every other prop
 *  through the attribute bags. */
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
    // Active is not idle — the resting paint must not ride along.
    expect(tab.classList.contains("host-tab-idle")).toBe(false);
    // The geometry the static class carried survives the state class.
    expect(tab.classList.contains("host-tab")).toBe(true);
    expect(tab.classList.contains("relative")).toBe(true);
  });

  it("gives the ACTIVE label its text tone on first paint", () => {
    const el = mount(() => ({ active: true, down: false }));
    const select = selectOf(el);
    expect(select.classList.contains("text-fg")).toBe(true);
    expect(select.classList.contains("text-fg-2")).toBe(false);
    // Static geometry kept.
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
    // `.host-tab-active.host-tab-down` is its own rule in index.css — a down
    // ACTIVE host keeps a (desaturated) belly, so both classes must land.
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
