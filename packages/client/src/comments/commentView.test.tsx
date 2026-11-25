// @vitest-environment happy-dom
/** TWO COMMENT-CAPTURING VIEWS MOUNTED AT ONCE — the Right panel's Code view
 *  under the Conductor and a work's reader, say. Each keeps its own draft and
 *  its own scroll request: a draft is drawn once and saved by the view it was
 *  opened in, the other view's navigation does not close it, and a jump made
 *  in one view does not move the other's toggle or get used up by it. */

import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import BrowseFileDispatcher from "../code-view/BrowseFileDispatcher";
import { Shown } from "../ui/shown";
import { CommentComposer } from "./CommentComposer";
import {
  CommentView,
  type CommentViewState,
  createCommentView,
} from "./commentView";
import { useComments } from "./useComments";

vi.mock("../code-view/BrowseFileView", () => ({
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
  dispose = render(() => <Shown value={() => true}>{body()}</Shown>, host);
};

const draft = {
  path: "notes.md",
  locator: { quote: "a line", prefix: "", suffix: "" },
  rect: { x: 0, y: 0, width: 1, height: 1 },
};

const composers = () =>
  document.querySelectorAll("[data-testid=kolu-comment-composer]");

/** Two views, each with its own composer, on two terminals. */
const VIEW_A = { kind: "terminal", id: "view-a-terminal" } as const;
const VIEW_B = { kind: "terminal", id: "view-b-terminal" } as const;
function twoViews(a: CommentViewState, b: CommentViewState) {
  mount(() => (
    <>
      <CommentView value={a}>
        <CommentComposer queue={VIEW_A} />
      </CommentView>
      <CommentView value={b}>
        <CommentComposer queue={VIEW_B} />
      </CommentView>
    </>
  ));
}

describe("two comment-capturing views mounted at once", () => {
  it("a draft opened in one is drawn once and saved to that view's terminal", () => {
    const a = createCommentView();
    const b = createCommentView();
    twoViews(a, b);

    a.composer.open(draft);
    // Opening a draft is a staged write: the popover is drawn on the flush
    // that follows, exactly as a user sees it a frame after their selection.
    flush();
    expect(composers()).toHaveLength(1);

    const box = document.querySelector<HTMLTextAreaElement>(
      "[data-testid=kolu-comment-composer] textarea",
    );
    if (!box) throw new Error("no composer text box");
    box.value = "Tighten this";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    // The typed body lands on the next flush; the click below is a later turn.
    flush();
    const save = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid=kolu-comment-composer] button",
      ),
    ).find((button) => button.textContent?.startsWith("Save"));
    save?.click();
    flush();

    expect(
      useComments(VIEW_A)
        .comments()
        .map((c) => c.body),
    ).toEqual(["Tighten this"]);
    expect(useComments(VIEW_B).comments()).toEqual([]);
    expect(composers()).toHaveLength(0);
  });

  it("the other view's navigation does not close the draft", () => {
    const a = createCommentView();
    const b = createCommentView();
    twoViews(a, b);

    a.composer.open(draft);
    // What a Code view does when what it shows changes.
    b.composer.close();
    flush();

    expect(a.composer.target()).not.toBeNull();
    expect(composers()).toHaveLength(1);
  });

  describe("a jump to a comment", () => {
    // The overlay that uses a request up runs only where the browser has the
    // CSS Custom Highlight API (`highlightOverlay.ts` returns at once without
    // it), and this test DOM has none — so it gets the two pieces the overlay
    // touches: a registry and a `Highlight`. happy-dom's `window.CSS` is a
    // getter handing out a fresh object, so the whole property is replaced.
    beforeAll(() => {
      Object.defineProperty(window, "CSS", {
        value: { highlights: new Map() },
        configurable: true,
      });
      Object.defineProperty(window, "Highlight", {
        value: class {
          constructor(..._ranges: unknown[]) {}
        },
        configurable: true,
      });
    });
    afterAll(() => {
      Reflect.deleteProperty(window, "CSS");
      Reflect.deleteProperty(window, "Highlight");
    });

    // The other view shows the same file of the same terminal — a work's view
    // borrowing the terminal the Right panel is on. The comment's quote is not
    // in what that view draws, so its overlay uses up a request it sees.
    const terminalId = "shared-terminal";
    const twoViewsOnOneFile = () => {
      const comment = useComments({ kind: "terminal", id: terminalId }).add({
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
          <CommentView value={a}>{null}</CommentView>
          <CommentView value={b}>
            <BrowseFileDispatcher
              at={shown()}
              comments={{ kind: "terminal", id: terminalId }}
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
        </>
      ));
      return { comment, a, b };
    };
    const renderedPressed = () =>
      document
        .querySelector("[data-testid=fileview-toggle-rendered]")
        ?.getAttribute("aria-pressed");
    const settle = () =>
      new Promise<void>((resolve) => setTimeout(resolve, 20));

    it("made in the view that draws the file, moves its toggle and is used up there (the control)", async () => {
      const { comment, b } = twoViewsOnOneFile();
      expect(renderedPressed()).toBe("true");

      b.scroll.set({
        commentId: comment.id,
        path: "plan.md",
        surface: "source",
      });
      await settle();

      expect(renderedPressed()).toBe("false");
      expect(b.scroll.request()).toBeNull();
    });

    it("made in the other view, neither moves this view's toggle nor is used up by it", async () => {
      const { comment, a } = twoViewsOnOneFile();
      expect(renderedPressed()).toBe("true");

      a.scroll.set({
        commentId: comment.id,
        path: "plan.md",
        surface: "source",
      });
      await settle();

      expect(renderedPressed()).toBe("true");
      expect(a.scroll.request()?.commentId).toBe(comment.id);
    });
  });
});
