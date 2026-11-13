// @vitest-environment happy-dom
/**
 * LONG LISTS IN THE PROSE — what a reader sees, and what survives.
 *
 * The assertions are about the reading: how many items are on screen, what the
 * one extra line says, and whether an opened list is still open after the
 * thing that drew it was rebuilt. No class names and no pixel sizes — those
 * are the look, and the look is allowed to change.
 *
 * `@kolu/solid-markdown` is scripted here rather than run for real, for a
 * platform reason, not a convenience one: its sanitize stage is a DOMPurify
 * boundary, and DOMPurify needs more of the platform than happy-dom
 * implements — under it a `<ul>` is dropped and its items are kept, so no
 * list would reach the DOM at all. (The package pins that stage in its own
 * suite, which runs under jsdom for exactly this reason, and the client runs
 * on happy-dom for the rest of its browser tests.) What the mock keeps is the
 * part of the package's contract this component depends on: the prose arrives
 * as HTML written through a RENDER effect, which is what puts the DOM in place
 * before the user effect that folds it. So the tests feed HTML where the app
 * feeds Markdown, and everything else here — the fold, the control, the
 * remembered open state — is the real thing.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@kolu/solid-markdown", async () => {
  // `vi.mock`'s factory is hoisted above this file's imports, so the
  // primitive it needs is reached from inside it — a static import would not
  // have been evaluated yet when the factory runs.
  const solid = await import("solid-js");
  // What the compiled `innerHTML={html()}` binding does inside the real
  // component: a render effect, so the prose lands in the update's pure phase,
  // before the user effect that folds it.
  return {
    Markdown: (props: { markdown: string }) => {
      const el = document.createElement("div");
      el.className = "kolu-md";
      solid.createRenderEffect(() => {
        el.innerHTML = props.markdown;
      });
      return el;
    },
  };
});

import ConductorProse from "./ConductorProse";
import { PROSE_LIST_FOLD_OVER, PROSE_LIST_FOLD_SHOWS } from "./proseListFold";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
});

/** Mount the prose and hand back its host element. */
function mount(rowId: string, text: () => string): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(
    render(() => <ConductorProse rowId={rowId} text={text()} />, host),
  );
  return host;
}

/** A list of `n` items as the renderer delivers it, each one recognisable. */
const bullets = (n: number, tag: "ul" | "ol" = "ul"): string =>
  `<${tag}>${Array.from(
    { length: n },
    (_, i) => `<li>check ${i + 1}</li>`,
  ).join("")}</${tag}>`;

/** The first list in the prose. */
function firstList(host: HTMLElement): HTMLElement {
  const list = host.querySelector<HTMLElement>("ul,ol");
  if (list === null) throw new Error("the prose rendered no list");
  return list;
}

/** The item texts a reader can actually see in `list` — items that are not
 *  hidden, and not the fold's own control line. */
function visibleItems(list: HTMLElement): string[] {
  return Array.from(list.children)
    .filter(
      (el) =>
        el.tagName === "LI" &&
        !el.hasAttribute("hidden") &&
        el.querySelector('[data-testid="conductor-prose-more"]') === null,
    )
    .map((el) => el.textContent?.trim() ?? "");
}

const control = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('[data-testid="conductor-prose-more"]');

describe("the Conductor's prose folds a long list", () => {
  it("shows three of six items and one line offering the rest", () => {
    const host = mount("row-six", () => bullets(6));

    expect(visibleItems(firstList(host))).toEqual([
      "check 1",
      "check 2",
      "check 3",
    ]);
    expect(control(host)?.textContent).toBe("and 3 more");
    expect(control(host)?.getAttribute("aria-expanded")).toBe("false");
    // The items are not gone — they are hidden, which is what the line offers
    // to undo, and `hidden` takes them out of the reading order for a screen
    // reader too.
    expect(firstList(host).querySelectorAll("li[hidden]")).toHaveLength(3);
  });

  it("opens the rest in place when the line is pressed, and closes again", () => {
    const host = mount("row-press", () => bullets(6));

    control(host)?.click();

    expect(visibleItems(firstList(host))).toEqual([
      "check 1",
      "check 2",
      "check 3",
      "check 4",
      "check 5",
      "check 6",
    ]);
    expect(control(host)?.getAttribute("aria-expanded")).toBe("true");
    // Still ONE line, and it now says the way back.
    expect(
      host.querySelectorAll('[data-testid="conductor-prose-more"]'),
    ).toHaveLength(1);
    expect(control(host)?.textContent).toBe("fewer");

    control(host)?.click();
    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
  });

  it("folds a numbered list the same way", () => {
    const host = mount("row-ordered", () => bullets(8, "ol"));

    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
    expect(control(host)?.textContent).toBe("and 5 more");
  });

  it("leaves a list of five alone — no hidden items, no extra line", () => {
    const host = mount("row-five", () => bullets(PROSE_LIST_FOLD_OVER));

    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_OVER);
    expect(control(host)).toBeNull();
  });

  it("keeps an opened list open when the row is rebuilt under the same id", () => {
    const first = mount("row-stable", () => bullets(6));
    control(first)?.click();
    expect(visibleItems(firstList(first))).toHaveLength(6);

    // The transcript swaps a row object and the component is built again — a
    // fold closing over the row, a chunk landing, a host tab coming back.
    for (const dispose of disposers.splice(0)) dispose();
    const rebuilt = mount("row-stable", () => bullets(6));

    expect(visibleItems(firstList(rebuilt))).toHaveLength(6);
    expect(control(rebuilt)?.getAttribute("aria-expanded")).toBe("true");

    // A different row starts closed: the memory is per list, not global.
    const other = mount("row-other", () => bullets(6));
    expect(visibleItems(firstList(other))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
  });

  it("re-folds prose that a streaming chunk has rewritten", () => {
    const [text, setText] = createSignal(bullets(2));
    const host = mount("row-streaming", text);
    expect(control(host)).toBeNull();

    // The turn goes on and the list grows past the measure.
    setText(`${bullets(8)}<p>that is the lot.</p>`);

    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
    expect(control(host)?.textContent).toBe("and 5 more");
  });

  it("counts only a top-level list's own items, and never folds a nested one", () => {
    // Three points, one of which has six sub-points: the answer is short, and
    // folding either level would cut a sentence in half.
    const host = mount(
      "row-nested",
      () => `<ul><li>one</li><li>two${bullets(6)}</li><li>three</li></ul>`,
    );

    expect(host.querySelectorAll("li[hidden]")).toHaveLength(0);
    expect(control(host)).toBeNull();
  });

  it("remembers each list of a row separately", () => {
    const host = mount("row-two-lists", () => `${bullets(6)}${bullets(7)}`);
    const lists = Array.from(host.querySelectorAll<HTMLElement>("ul"));
    const [first, second] = lists;
    if (first === undefined || second === undefined)
      throw new Error("expected two lists");

    second
      .querySelector<HTMLButtonElement>('[data-testid="conductor-prose-more"]')
      ?.click();

    expect(visibleItems(first)).toHaveLength(PROSE_LIST_FOLD_SHOWS);
    expect(visibleItems(second)).toHaveLength(7);
  });
});
