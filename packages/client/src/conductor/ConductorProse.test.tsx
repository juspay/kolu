// @vitest-environment happy-dom

import type * as SolidMarkdown from "@kolu/solid-markdown";
import { ABOUT_WORK, type Work, type WorkId } from "kolu-work";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  return {
    ...actual,
    Markdown: (props: {
      markdown: string;
      inlineCode?: {
        action: Parameters<typeof actual.decorateInlineCode>[1];
        onPress: (text: string, anchor: HTMLElement) => void;
      };
      onRendered?: () => void;
    }) => {
      const el = document.createElement("div");
      el.className = "kolu-md";
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
        solid.untrack(() => props.onRendered?.());
      });
      actual.bindMarkdownLinks(el, {
        onInlineCode: (text, anchor) => props.inlineCode?.onPress(text, anchor),
      });
      return el;
    },
  };
});

const [works, setWorks] = createSignal<ReadonlyMap<WorkId, Work>>(new Map());
vi.mock("./useWorks", () => ({ useWorkMap: () => works }));

import ConductorProse from "./ConductorProse";
import { fileHolders } from "./namedFiles";
import { PROSE_LIST_FOLD_OVER, PROSE_LIST_FOLD_SHOWS } from "./proseListFold";
import { closeReader, readerTarget } from "./reader/useReader";

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
  setWorks(new Map());
  closeReader();
});

function mount(
  rowId: string,
  text: () => string,
  onRedrawn?: () => void,
  turn: ReadonlyArray<WorkId> = [],
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(
    render(
      () => (
        <ConductorProse
          rowId={rowId}
          text={text()}
          works={turn}
          holders={fileHolders(works())}
          onRedrawn={onRedrawn}
        />
      ),
      host,
    ),
  );
  return host;
}

const bullets = (n: number, tag: "ul" | "ol" = "ul"): string =>
  `<${tag}>${Array.from(
    { length: n },
    (_, i) => `<li>check ${i + 1}</li>`,
  ).join("")}</${tag}>`;

function firstList(host: HTMLElement): HTMLElement {
  const list = host.querySelector<HTMLElement>("ul,ol");
  if (list === null) throw new Error("the prose rendered no list");
  return list;
}

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

    for (const dispose of disposers.splice(0)) dispose();
    const rebuilt = mount("row-stable", () => bullets(6));

    expect(visibleItems(firstList(rebuilt))).toHaveLength(6);
    expect(control(rebuilt)?.getAttribute("aria-expanded")).toBe("true");

    const other = mount("row-other", () => bullets(6));
    expect(visibleItems(firstList(other))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
  });

  it("re-folds prose that a streaming chunk has rewritten", () => {
    const [text, setText] = createSignal(bullets(2));
    const host = mount("row-streaming", text);
    expect(control(host)).toBeNull();

    setText(`${bullets(8)}<p>that is the lot.</p>`);

    expect(visibleItems(firstList(host))).toHaveLength(PROSE_LIST_FOLD_SHOWS);
    expect(control(host)?.textContent).toBe("and 5 more");
  });

  it("counts only a top-level list's own items, and never folds a nested one", () => {
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

  it("reports every rewrite of the prose, and never a press on the fold", () => {
    let redrawn = 0;
    const host = mount(
      "row-report",
      () => bullets(6),
      () => redrawn++,
    );
    const afterMount = redrawn;

    control(host)?.click();
    expect(redrawn).toBe(afterMount);

    markdownMock.redraw();
    expect(redrawn).toBe(afterMount + 1);
  });
});

describe("a file the Conductor names", () => {
  const AT = "2026-11-16T00:00:00.000Z";

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

  const link = (host: HTMLElement): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>("button[data-md-code-action]");

  it("opens the reader on the one work that holds it, and reads as open", () => {
    setWorks(new Map([["w-parser" as WorkId, workWith("parser", [PLAN])]]));
    const host = mount("row-plan", () => SAID);

    link(host)?.click();

    expect(readerTarget()).toEqual({ work: "w-parser", path: PLAN });
    expect(link(host)?.getAttribute("aria-current")).toBe("true");
  });

  it("offers the works as chips when several hold it, and opens the one chosen", () => {
    setWorks(
      new Map([
        ["w-parser" as WorkId, workWith("rewrite the parser", [PLAN])],
        ["w-login" as WorkId, workWith("fix the login", [PLAN])],
      ]),
    );
    const host = mount("row-two", () => SAID);

    link(host)?.click();
    expect(readerTarget()).toBeNull();
    const offered = Array.from(
      document.querySelectorAll(
        '[data-testid="named-file-menu"] [data-testid^="named-file-option-"] [data-testid="work-chip-face"]',
      ),
    ).map((one) => one.textContent?.trim());
    expect(offered).toEqual(["rewrite the parser", "fix the login"]);

    document
      .querySelector<HTMLButtonElement>(
        '[data-testid="named-file-option-w-login"]',
      )
      ?.click();
    expect(readerTarget()).toEqual({ work: "w-login", path: PLAN });
    expect(
      document.querySelector('[data-testid="named-file-menu"]'),
    ).toBeNull();
  });

  it("opens the turn's own work's file without asking, whoever else has one", () => {
    setWorks(
      new Map([
        ["w-parser" as WorkId, workWith("rewrite the parser", [PLAN])],
        ["w-login" as WorkId, workWith("fix the login", [PLAN])],
      ]),
    );
    const host = mount("row-turn", () => SAID, undefined, [
      "w-login" as WorkId,
    ]);

    link(host)?.click();

    expect(readerTarget()).toEqual({ work: "w-login", path: PLAN });
    expect(
      document.querySelector('[data-testid="named-file-menu"]'),
    ).toBeNull();
  });

  it("says in place that the turn's work has no such file, and offers no other", () => {
    setWorks(
      new Map([
        ["w-parser" as WorkId, workWith("rewrite the parser", [PLAN])],
        ["w-split" as WorkId, workWith("split the column", [])],
      ]),
    );
    const host = mount("row-missing", () => SAID, undefined, [
      "w-split" as WorkId,
    ]);

    link(host)?.click();

    expect(readerTarget()).toBeNull();
    const note = document.querySelector('[data-testid="named-file-missing"]');
    expect(note?.getAttribute("role")).toBe("status");
    expect(note?.textContent).toContain("split the column");
    expect(note?.textContent).not.toContain("rewrite the parser");
    expect(
      document.querySelector('[data-testid="named-file-menu"]'),
    ).toBeNull();
    expect(link(host)?.getAttribute("aria-label")).not.toMatch(/^Open /);
    setWorks(
      new Map([
        ["w-parser" as WorkId, workWith("rewrite the parser", [PLAN])],
        ["w-split" as WorkId, workWith("split the column", [PLAN])],
      ]),
    );
    expect(
      document.querySelector('[data-testid="named-file-missing"]'),
    ).toBeNull();
    link(host)?.click();
    expect(readerTarget()).toEqual({ work: "w-split", path: PLAN });
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
