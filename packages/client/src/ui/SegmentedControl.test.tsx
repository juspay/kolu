// @vitest-environment happy-dom
/**
 * `SegmentedControl`'s keyboard contract, for every caller: ONE tab stop (a
 * roving tabindex) — the pressed option, or `restingValue` while none is — and
 * ← → / Home / End move focus within the group without picking; a click (what
 * Enter / Space do on a focused button) picks. With no value, nothing is pressed.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import SegmentedControl, {
  rovingMove,
  rovingTabStop,
} from "./SegmentedControl";

const OPTIONS = [
  { value: "off", label: "Off" },
  { value: "vanilla", label: "vanilla" },
  { value: "juspay", label: "juspay" },
] as const;
type V = (typeof OPTIONS)[number]["value"];

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(initial: V | undefined, restingValue?: V) {
  const [value, setValue] = createSignal<V | undefined>(initial);
  const picks: V[] = [];
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <SegmentedControl
        options={OPTIONS}
        value={value()}
        restingValue={restingValue}
        onChange={(v) => {
          picks.push(v);
          setValue(() => v);
        }}
        testIdPrefix="seg"
      />
    ),
    host,
  );
  const button = (v: V) =>
    host?.querySelector<HTMLButtonElement>(`[data-testid="seg-${v}"]`) ??
    undefined;
  const tabStops = () =>
    OPTIONS.map((o) => o.value).filter((v) => button(v)?.tabIndex === 0);
  const pressed = () =>
    OPTIONS.map((o) => o.value).filter(
      (v) => button(v)?.getAttribute("aria-pressed") === "true",
    );
  const key = (k: string) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
  return { button, tabStops, pressed, key, picks };
}

describe("SegmentedControl — the roving tab stop", () => {
  it("is the pressed option, and only it", () => {
    const c = mount("juspay");
    expect(c.tabStops()).toEqual(["juspay"]);
    expect(c.pressed()).toEqual(["juspay"]);
  });

  it("with nothing pressed: no aria-pressed anywhere, the resting option holds the stop", () => {
    const c = mount(undefined, "vanilla");
    expect(c.pressed()).toEqual([]);
    expect(c.tabStops()).toEqual(["vanilla"]);
  });

  it("with nothing pressed and no resting option, the first holds it", () => {
    expect(mount(undefined).tabStops()).toEqual(["off"]);
  });

  it("arrows move focus (and the stop) without picking; a click picks", () => {
    const c = mount(undefined, "vanilla");
    c.button("vanilla")?.focus();
    c.key("ArrowRight");
    expect(document.activeElement).toBe(c.button("juspay"));
    expect(c.tabStops()).toEqual(["juspay"]);
    c.key("ArrowRight"); // wraps
    expect(document.activeElement).toBe(c.button("off"));
    c.key("ArrowLeft"); // wraps back
    expect(document.activeElement).toBe(c.button("juspay"));
    c.key("Home");
    expect(document.activeElement).toBe(c.button("off"));
    c.key("End");
    expect(document.activeElement).toBe(c.button("juspay"));
    expect(c.picks).toEqual([]);
    expect(c.pressed()).toEqual([]);
    c.button("juspay")?.click();
    expect(c.picks).toEqual(["juspay"]);
    expect(c.pressed()).toEqual(["juspay"]);
  });

  it("leaving the group hands the stop back to the pressed option", () => {
    const c = mount("off");
    c.button("off")?.focus();
    c.key("ArrowRight");
    expect(c.tabStops()).toEqual(["vanilla"]);
    c.button("vanilla")?.blur();
    expect(c.tabStops()).toEqual(["off"]);
  });
});

describe("rovingTabStop / rovingMove", () => {
  it("prefers focused, then pressed, then resting, then the first — each only if offered", () => {
    const options = OPTIONS;
    expect(
      rovingTabStop({
        options,
        focused: "juspay",
        value: "off",
        restingValue: "vanilla",
      }),
    ).toBe("juspay");
    expect(
      rovingTabStop({
        options,
        focused: undefined,
        value: "off",
        restingValue: "vanilla",
      }),
    ).toBe("off");
    expect(
      rovingTabStop({
        options,
        focused: undefined,
        value: undefined,
        restingValue: "vanilla",
      }),
    ).toBe("vanilla");
    expect(
      rovingTabStop<string>({
        options,
        focused: undefined,
        value: "gone",
        restingValue: undefined,
      }),
    ).toBe("off");
    expect(
      rovingTabStop({
        options: [],
        focused: undefined,
        value: undefined,
        restingValue: undefined,
      }),
    ).toBeUndefined();
  });

  it("moves with wrap, and ignores other keys", () => {
    expect(rovingMove("ArrowRight", 2, 3)).toBe(0);
    expect(rovingMove("ArrowLeft", 0, 3)).toBe(2);
    expect(rovingMove("Home", 1, 3)).toBe(0);
    expect(rovingMove("End", 0, 3)).toBe(2);
    expect(rovingMove("Enter", 0, 3)).toBeUndefined();
    expect(rovingMove("ArrowRight", 0, 0)).toBeUndefined();
  });
});
