// @vitest-environment happy-dom
/**
 * `SegmentedControl`'s keyboard contract, for every caller: ONE tab stop (a
 * roving tabindex) — the pressed option, or `restingValue` while none is — and
 * ← → / Home / End move focus within the group without picking; Enter or Space
 * on the focused option picks it once, as does a click. With no value, nothing
 * is pressed. Re-emitted options for the same values keep their buttons and the
 * focus, and autofocus never steals focus from something else.
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

function mount(
  initial: V | undefined,
  restingValue?: V,
  extra: { autofocus?: boolean } = {},
) {
  const [value, setValue] = createSignal<V | undefined>(initial);
  const [options, setOptions] =
    createSignal<readonly { value: V; label: string }[]>(OPTIONS);
  const picks: V[] = [];
  const stopTrail: (V | undefined)[] = [];
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <SegmentedControl
        options={options()}
        value={value()}
        restingValue={restingValue}
        autofocus={extra.autofocus}
        onTabStopChange={(v) => stopTrail.push(v)}
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
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
  return { button, tabStops, pressed, key, picks, setOptions, stopTrail };
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

describe("SegmentedControl — picking from the keyboard", () => {
  it("Enter picks the focused option, once", () => {
    const c = mount(undefined, "vanilla");
    c.button("vanilla")?.focus();
    c.key("Enter");
    expect(c.picks).toEqual(["vanilla"]);
    expect(c.pressed()).toEqual(["vanilla"]);
  });

  it("Space picks the focused option, once", () => {
    const c = mount("off");
    c.button("off")?.focus();
    c.key("ArrowRight");
    c.key("ArrowRight");
    c.key(" ");
    expect(c.picks).toEqual(["juspay"]);
  });

  it("tells the host the tab stop — at mount, as the keyboard moves, and back when it leaves", () => {
    const c = mount("juspay", "vanilla");
    c.button("juspay")?.focus();
    c.key("ArrowLeft");
    c.button("vanilla")?.blur();
    expect(c.stopTrail).toEqual(["juspay", "vanilla", "juspay"]);
    // The stop it reports is the one the buttons carry.
    expect(c.tabStops()).toEqual([c.stopTrail.at(-1)]);
  });

  it("reports the resting option, not a pressed value the options do not hold", () => {
    // An unknown stored choice: nothing it names is on offer, so the stop — and
    // what the host is told — is the resting option.
    const c = mount("gone" as V, "vanilla");
    expect(c.stopTrail).toEqual(["vanilla"]);
    expect(c.tabStops()).toEqual(["vanilla"]);
  });
});

describe("SegmentedControl — re-emitted options", () => {
  it("fresh option objects for the same values keep the buttons, and the focus", () => {
    const c = mount(undefined, "vanilla");
    const before = c.button("juspay");
    before?.focus();
    c.setOptions(OPTIONS.map((o) => ({ ...o })));
    expect(c.button("juspay")).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(c.tabStops()).toEqual(["juspay"]);
  });
});

describe("SegmentedControl — autofocus", () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  it("focuses the tab stop when nothing else holds the focus", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const c = mount(undefined, "vanilla", { autofocus: true });
    await frame();
    expect(document.activeElement).toBe(c.button("vanilla"));
  });

  it("never steals the focus from something else", async () => {
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    const c = mount(undefined, "vanilla", { autofocus: true });
    await frame();
    expect(document.activeElement).toBe(other);
    expect(c.button("vanilla")).not.toBe(document.activeElement);
    other.remove();
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
