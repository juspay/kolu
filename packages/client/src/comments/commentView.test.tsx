// @vitest-environment happy-dom
/** TWO COMMENT-CAPTURING VIEWS MOUNTED AT ONCE — the Right panel's Code view
 *  under the Conductor and a work's reader, say. Each keeps its own draft and
 *  its own scroll request: a draft is drawn once and saved by the view it was
 *  opened in, the other view's navigation does not close it, and a jump made
 *  in one view does not move the other's toggle or get used up by it. */

import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import BrowseFileDispatcher from "../right-panel/BrowseFileDispatcher";
import { Shown } from "../ui/shown";
import { CommentComposer } from "./CommentComposer";
import {
  CommentView,
  type CommentViewState,
  createCommentView,
} from "./commentView";
import { useComments } from "./useComments";

vi.mock("../right-panel/BrowseFileView", () => ({
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

const mount = (body: () => JSX.Element): void => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <Shown.Provider value={() => true}>{body()}</Shown.Provider>,
    host,
  );
};

const draft = {
  path: "notes.md",
  locator: { quote: "a line", prefix: "", suffix: "" },
  rect: { x: 0, y: 0, width: 1, height: 1 },
};

const composers = () =>
  document.querySelectorAll("[data-testid=kolu-comment-composer]");

/** Two views, each with its own composer, on two terminals. */
function twoViews(a: CommentViewState, b: CommentViewState) {
  mount(() => (
    <>
      <CommentView.Provider value={a}>
        <CommentComposer terminalId="view-a-terminal" />
      </CommentView.Provider>
      <CommentView.Provider value={b}>
        <CommentComposer terminalId="view-b-terminal" />
      </CommentView.Provider>
    </>
  ));
}

describe("two comment-capturing views mounted at once", () => {
  it("a draft opened in one is drawn once and saved to that view's terminal", () => {
    const a = createCommentView();
    const b = createCommentView();
    twoViews(a, b);

    a.composer.open(draft);
    expect(composers()).toHaveLength(1);

    const box = document.querySelector<HTMLTextAreaElement>(
      "[data-testid=kolu-comment-composer] textarea",
    );
    if (!box) throw new Error("no composer text box");
    box.value = "Tighten this";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    const save = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid=kolu-comment-composer] button",
      ),
    ).find((button) => button.textContent?.startsWith("Save"));
    save?.click();

    expect(
      useComments("view-a-terminal")
        .comments()
        .map((c) => c.body),
    ).toEqual(["Tighten this"]);
    expect(useComments("view-b-terminal").comments()).toEqual([]);
    expect(composers()).toHaveLength(0);
  });

  it("the other view's navigation does not close the draft", () => {
    const a = createCommentView();
    const b = createCommentView();
    twoViews(a, b);

    a.composer.open(draft);
    // What a Code view does when what it shows changes.
    b.composer.close();

    expect(a.composer.target()).not.toBeNull();
    expect(composers()).toHaveLength(1);
  });

  it("a jump made in one view neither flips the other's toggle nor is used up by it", async () => {
    // The other view shows the same file of the same terminal — a work's view
    // borrowing the terminal the Right panel is on. The comment's quote is not
    // in what that view draws, so its overlay would clear a request it saw.
    const terminalId = "shared-terminal";
    const comment = useComments(terminalId).add({
      path: "plan.md",
      locator: { quote: "words not in the plan", prefix: "", suffix: "" },
      surface: "source",
      body: "Say why",
    });
    const a = createCommentView();
    const b = createCommentView();
    const [shown] = createSignal({ host: "local", terminalId });
    mount(() => (
      <>
        <CommentView.Provider value={a}>{null}</CommentView.Provider>
        <CommentView.Provider value={b}>
          <BrowseFileDispatcher
            at={shown()}
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
        </CommentView.Provider>
      </>
    ));
    const renderedPressed = () =>
      document
        .querySelector("[data-testid=fileview-toggle-rendered]")
        ?.getAttribute("aria-pressed");
    expect(renderedPressed()).toBe("true");

    a.scroll.set({ commentId: comment.id, path: "plan.md", surface: "source" });
    await Promise.resolve();

    expect(renderedPressed()).toBe("true");
    expect(a.scroll.request()?.commentId).toBe(comment.id);
  });
});
