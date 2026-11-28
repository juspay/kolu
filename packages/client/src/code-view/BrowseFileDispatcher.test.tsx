// @vitest-environment happy-dom
/** WHAT THE ONE VIEWER DRAWS for a file read as text: code, a rendered
 *  document — or, for content that is not text at all (a NUL in it, git's
 *  own test), the no-preview line rather than a screen of garbage. */

import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import BrowseFileDispatcher from "./BrowseFileDispatcher";

import { CommentView, createCommentView } from "../comments/commentView";
import type { CommentQueue } from "../comments/types";
import { Shown } from "../ui/shown";

// The source view is pierre's highlighter, which is not this test's subject:
// what is pinned is WHICH view the dispatcher picks. Pierre itself loads a
// grammar only the app's Vite build can resolve, so it is stubbed too.
vi.mock("./BrowseFileView", () => ({
  default: (props: { content: string }) => (
    <pre data-testid="source-view">{props.content}</pre>
  ),
}));
vi.mock("@kolu/solid-pierre", () => ({ codeViewItemIdAt: () => undefined }));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
});

const show = (path: string, content: string): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  // Built once, here: written inline the comment view would be rebuilt on
  // every read of the provider's `value` prop (a call expression compiles to
  // a getter).
  const comments = createCommentView();
  dispose = render(
    () => (
      // The viewer is drawn inside the view that holds its comment state.
      <CommentView value={comments}>
        <BrowseFileDispatcher
          at={null}
          comments={null}
          open={null}
          filePath={path}
          file={{ path, source: { content, truncated: false } }}
          error={undefined}
          repoVault={{ paths: [], pending: false }}
          theme="dark"
        />
      </CommentView>
    ),
    host,
  );
  return host;
};

describe("a file read as text", () => {
  it("says there is no preview when the content holds a NUL", () => {
    const host = show(
      ".waterfall/mockup/fonts/a.woff2",
      "wOF2\0\0\u0001garbage",
    );
    expect(host.querySelector("[data-testid=file-no-preview]")).not.toBeNull();
    expect(host.querySelector("[data-testid=source-view]")).toBeNull();
  });

  it("draws ordinary text as source, as before", () => {
    const host = show("notes.txt", "plain words");
    expect(host.querySelector("[data-testid=file-no-preview]")).toBeNull();
    expect(host.querySelector("[data-testid=source-view]")?.textContent).toBe(
      "plain words",
    );
  });

  it("offers markdown its rendered view, as before", () => {
    const host = show("plan.md", "# The plan");
    expect(host.querySelector("[data-testid=file-no-preview]")).toBeNull();
    expect(
      host
        .querySelector("[data-testid=fileview-toggle-rendered]")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("a drawn document, as its comment queue comes and goes", () => {
  // A Code tab can draw a file before it has a terminal to file comments in,
  // and the terminal then arrives — or leaves. The document is mounted once:
  // commenting turns on and off around it, and the one drawn document is
  // never moved between two wrappers.
  it("keeps the drawn document in the page exactly once, and throws nothing", () => {
    const [queue, setQueue] = createSignal<CommentQueue | null>(null);
    const host = document.createElement("div");
    document.body.append(host);
    // One comment view, handed over as it is — see `show`.
    const comments = createCommentView();
    dispose = render(
      () => (
        // Commenting asks whether its pane is shown, as every pane does.
        <Shown value={() => true}>
          <CommentView value={comments}>
            <BrowseFileDispatcher
              at={null}
              comments={queue()}
              open={null}
              filePath="plan.md"
              file={{
                path: "plan.md",
                source: { content: "# The plan", truncated: false },
              }}
              error={undefined}
              repoVault={{ paths: [], pending: false }}
              theme="dark"
            />
          </CommentView>
        </Shown>
      ),
      host,
    );
    // THE DRAWN DOCUMENT, the element the Markdown view is drawn into. Its
    // heading is drawn by the Markdown library after mount; what is pinned
    // here is that the one drawn document stays in the page, unmoved.
    const documents = () =>
      Array.from(
        host.querySelectorAll("[data-testid=browse-preview-markdown]"),
      );
    const [drawn] = documents();
    expect(drawn).toBeDefined();
    expect(documents()).toHaveLength(1);

    // The write is flushed before the page is read: the wrapper around the
    // document is rebuilt on the flush, and what is pinned is that the one
    // drawn document survives it.
    expect(() => {
      setQueue({ kind: "terminal", id: "t-1" });
      flush();
    }).not.toThrow();
    expect(documents()).toEqual([drawn]);

    expect(() => {
      setQueue(null);
      flush();
    }).not.toThrow();
    expect(documents()).toEqual([drawn]);
  });
});
