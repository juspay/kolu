// @vitest-environment happy-dom
/**
 * THE CONDUCTOR'S PROSE — long lists folded, and the files it names opening.
 *
 * The assertions are about the reading: how many items are on screen, what the
 * one extra line says, whether an opened list is still open after the thing
 * that drew it was rebuilt, and where a named file's press lands. No class
 * names and no pixel sizes — those are the look, and the look is allowed to
 * change.
 *
 * `@kolu/solid-markdown` is scripted here rather than run for real, for a
 * platform reason, not a convenience one: its sanitize stage is a DOMPurify
 * boundary, and DOMPurify needs more of the platform than happy-dom
 * implements — under it a `<ul>` is dropped and its items are kept, so no
 * list would reach the DOM at all. (The package pins that stage in its own
 * suite, which runs under jsdom for exactly this reason, and the client runs
 * on happy-dom for the rest of its browser tests.) What the mock keeps is the
 * part of the package's contract this component depends on: the prose arrives
 * as HTML written through a RENDER effect, and `onRendered` is called from a
 * USER effect after every such write — which is what puts the DOM in place
 * before the fold runs. It can also rewrite its DOM with the text unchanged,
 * as the real one does when a diagram lands. The package's OWN inline-code
 * step and click seam (`decorateInlineCode`, `bindMarkdownLinks`) run for
 * real. So the tests feed HTML where the app feeds Markdown, and everything
 * else here — the fold, the control, the remembered open state, the links —
 * is the real thing.
 */

import type * as SolidMarkdown from "@kolu/solid-markdown";
import { ABOUT_WORK, type Work, type WorkId } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Rewrite every mounted prose's DOM without changing its text — what a
 *  diagram landing does to the real component. */
const markdownMock = vi.hoisted(() => ({ redraw: () => {} }));

vi.mock("@kolu/solid-markdown", async () => {
  // `vi.mock`'s factory is hoisted above this file's imports, so the
  // primitive it needs is reached from inside it — a static import would not
  // have been evaluated yet when the factory runs.
  const solid = await import("solid-js");
  const actual = await vi.importActual<typeof SolidMarkdown>(
    "@kolu/solid-markdown",
  );
  const [redraws, setRedraws] = solid.createSignal(0);
  markdownMock.redraw = () => setRedraws((n) => n + 1);
  // What the real component does: the compiled `innerHTML={html()}` binding
  // is a render effect, so the prose lands in the update's pure phase; then a
  // user effect hands the container to `onRendered`, untracked.
  return {
    ...actual,
    Markdown: (props: {
      markdown: string;
      inlineCode?: {
        action: Parameters<typeof actual.decorateInlineCode>[1];
        onPress: (text: string, anchor: HTMLElement) => void;
      };
      onRendered?: (el: HTMLElement) => void;
    }) => {
      const el = document.createElement("div");
      el.className = "kolu-md";
      // Like the real `html` memo: the decorated prose, re-derived when the
      // text, what the links answer, or a scripted redraw changes.
      const html = solid.createMemo(
        () => {
          redraws();
          const inlineCode = props.inlineCode;
          return inlineCode === undefined
            ? props.markdown
            : actual.decorateInlineCode(props.markdown, inlineCode.action);
        },
        undefined,
        { equals: false },
      );
      solid.createRenderEffect(() => {
        el.innerHTML = html();
      });
      solid.createEffect(() => {
        html();
        solid.untrack(() => props.onRendered?.(el));
      });
      actual.bindMarkdownLinks(el, {
        onInlineCode: (text, anchor) => props.inlineCode?.onPress(text, anchor),
      });
      return el;
    },
  };
});

/** The works the prose names files of — the live collection, scripted. */
const [works, setWorks] = createSignal<ReadonlyMap<WorkId, Work>>(new Map());
vi.mock("./useWorks", () => ({ useWorkMap: () => works }));

import ConductorProse from "./ConductorProse";
import { PROSE_LIST_FOLD_OVER, PROSE_LIST_FOLD_SHOWS } from "./proseListFold";
import { closeReader, readerTarget } from "./reader/useReader";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
  setWorks(new Map());
  closeReader();
});

/** Mount the prose and hand back its host element. */
function mount(
  rowId: string,
  text: () => string,
  onRedrawn?: () => void,
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(
    render(
      () => (
        <ConductorProse rowId={rowId} text={text()} onRedrawn={onRedrawn} />
      ),
      host,
    ),
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

  it("keeps a folded list folded, and an opened one open, when the prose is redrawn in place", () => {
    const host = mount("row-redrawn", () => `${bullets(8)}<p>a diagram</p>`);
    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);

    markdownMock.redraw();
    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
    expect(control(host)?.textContent).toBe("and 5 more");

    control(host)?.click();
    markdownMock.redraw();
    expect(visibleItems(firstList(host))).toHaveLength(8);

    // The control the redraw minted afresh still works.
    control(host)?.click();
    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
  });

  it("answers a press on a list that only a later chunk brought", () => {
    const [text, setText] = createSignal("<p>thinking</p>");
    const host = mount("row-late-list", text);

    setText(bullets(7));
    control(host)?.click();

    expect(visibleItems(firstList(host))).toHaveLength(7);
  });

  it("reports a redraw of unchanged text, and nothing else, as redrawn", () => {
    const [text, setText] = createSignal(bullets(6));
    let redrawn = 0;
    const host = mount("row-report", text, () => redrawn++);

    setText(`${bullets(6)}<p>more</p>`);
    control(host)?.click();
    expect(redrawn).toBe(0);

    markdownMock.redraw();
    expect(redrawn).toBe(1);
  });
});

describe("a file the Conductor names", () => {
  const AT = "2026-11-16T00:00:00.000Z";

  /** A work in progress that has seen `paths` appear in its `.waterfall/`. */
  const workWith = (title: string, paths: readonly string[]): Work => ({
    key: {
      kind: "branch",
      host: "local",
      repo: "/src/app",
      branch: title.replaceAll(" ", "-"),
    },
    title,
    startedAt: AT,
    decisions: [],
    events: paths.map((path) => ({
      at: AT,
      by: "kolu",
      about: ABOUT_WORK,
      kind: "file",
      path,
    })),
    state: { kind: "open" },
  });

  const PLAN = ".waterfall/plan.md";
  const SAID = `<p>Its plan is at <code>${PLAN}</code>.</p>`;

  /** The link a named path became, found by its accessible name. */
  const link = (host: HTMLElement): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="Open ${PLAN}"]`);

  it("opens the reader on the one work that holds it, and reads as open", () => {
    setWorks(new Map([["w-parser" as WorkId, workWith("parser", [PLAN])]]));
    const host = mount("row-plan", () => SAID);

    link(host)?.click();

    expect(readerTarget()).toEqual({ work: "w-parser", path: PLAN });
    expect(link(host)?.getAttribute("aria-current")).toBe("true");
  });

  it("offers the works by title when several hold it, and opens the one chosen", () => {
    setWorks(
      new Map([
        ["w-parser" as WorkId, workWith("rewrite the parser", [PLAN])],
        ["w-login" as WorkId, workWith("fix the login", [PLAN])],
      ]),
    );
    const host = mount("row-two", () => SAID);

    link(host)?.click();
    // NOTHING OPENED YET — no guess at which one the sentence meant.
    expect(readerTarget()).toBeNull();
    const offered = Array.from(
      document.querySelectorAll('[data-testid^="named-file-option-"]'),
    ).map((one) => one.textContent?.trim());
    expect(offered).toEqual(["rewrite the parser", "fix the login"]);

    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="named-file-option-w-login"]',
      )
      ?.click();
    expect(readerTarget()).toEqual({ work: "w-login", path: PLAN });
  });

  it("leaves a path no work holds as plain code", () => {
    setWorks(new Map([["w-parser" as WorkId, workWith("parser", [PLAN])]]));
    const host = mount(
      "row-other",
      () => "<p>See <code>.waterfall/brief.md</code>.</p>",
    );

    expect(host.querySelector("button[data-md-code-action]")).toBeNull();
    expect(host.querySelector("code")?.textContent).toBe(".waterfall/brief.md");
  });

  it("becomes a link once the file appears, after the sentence was written", () => {
    setWorks(new Map([["w-parser" as WorkId, workWith("parser", [])]]));
    const host = mount("row-later", () => SAID);
    expect(link(host)).toBeNull();

    setWorks(new Map([["w-parser" as WorkId, workWith("parser", [PLAN])]]));

    expect(link(host)).not.toBeNull();
  });
});
