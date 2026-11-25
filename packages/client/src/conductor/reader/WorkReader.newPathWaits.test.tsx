// @vitest-environment happy-dom
/** A NEW PATH WAITS; THE SAME PATH KEEPS ITS DOCUMENT.
 *
 *  A tab press changes what the reader shows: the old file leaves, and the
 *  waiting line stands under the new tab's name until the new file's bytes
 *  land, while the header and the tabs beside it keep drawing. A second read
 *  of the SAME path (the work ends while the reader is open and the source
 *  becomes kolu's kept copy) is not a new document: the text stays on screen
 *  until the new bytes land. */

import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const reads = new Map<string, (text: string) => void>();
  return {
    reads,
    /** The signal the source reads, so the test can hand the reader a NEW
     *  source for an unchanged path. The test installs it. */
    revision: (() => 0) as () => number,
    resolve(path: string, text: string) {
      const settle = reads.get(path);
      if (!settle) throw new Error(`no pending read for ${path}`);
      reads.delete(path);
      settle(text);
    },
  };
});

vi.mock("../../code-view/BrowseFileDispatcher", () => ({
  default: (props: { file: { text?: string } | null }) => (
    <div data-testid="doc">{props.file?.text ?? "no file"}</div>
  ),
}));
vi.mock("../workFile", () => ({
  workFileName: (path: string) => path,
  workFileSource: () => {
    // Tracked by the caller's memo, so a bump is a new source for the same
    // path — the "work ended while the reader is open" case.
    fixture.revision();
    return {
      at: null,
      list: () => Promise.resolve({ rows: [], more: false }),
      read: (path: string) => {
        const pending = Promise.withResolvers<{ text: string }>();
        fixture.reads.set(path, (text) => pending.resolve({ text }));
        return pending.promise;
      },
    };
  },
  createWorkFiles: () => ({
    rows: () => [],
    more: () => false,
    pending: () => false,
  }),
}));
vi.mock("../useWorks", () => ({
  useWorkMap: () => () => new Map([["w1", { id: "w1" }]]),
  useWorkMembers: () => () => [],
}));
vi.mock("../workFacts", () => ({
  readWorkFacts: () => ({ members: () => [] }),
}));
vi.mock("../workReadings", () => ({ membersIn: () => [] }));
vi.mock("kolu-work", () => ({ openAsks: () => [] }));
vi.mock("../../comments/useComments", () => ({
  commentsForTerminal: () => () => ({ commentsForPath: () => [] }),
}));
vi.mock("../../comments/commentView", () => ({
  CommentView: (props: { children: unknown }) => props.children,
  createCommentView: () => ({}),
}));
vi.mock("../../comments/CommentComposer", () => ({
  CommentComposer: () => null,
}));
vi.mock("../../comments/formatMarkdown", () => ({ formatMarkdown: () => "" }));
vi.mock("../../right-panel/openInCodeTab", () => ({
  rightPanelCodeDoor: () => ({ open: () => {} }),
}));
vi.mock("../../settings/useColorScheme", () => ({
  useColorScheme: () => ({ themeTypeLiteral: () => "dark" }),
}));
vi.mock("../WorkChip", () => ({ default: () => null }));
vi.mock("../WorkChipFace", () => ({ default: () => null }));
vi.mock("../WorkFileList", () => ({ default: () => null }));
vi.mock("../WorkQuestion", () => ({ default: () => null }));

import WorkReader from "./WorkReader";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
  fixture.reads.clear();
});

/** Let the resolved read reach the document. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  flush();
}

function text(testid: string): string | null {
  if (!host) throw new Error("not mounted");
  return host.querySelector(`[data-testid='${testid}']`)?.textContent ?? null;
}

it("waits under a new path's name and keeps the document on a re-read of the same path", async () => {
  const [path, setPath] = createSignal("plan.md");
  const [revision, setRevision] = createSignal(0);
  fixture.revision = revision;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <WorkReader
        target={{ work: "w1", path: path() }}
        from="reader"
        onOpen={() => {}}
        listing={false}
      />
    ),
    host,
  );
  await settle();

  // The first read shows the waiting line — and the header beside it draws,
  // so the page is not waiting on the document.
  expect(text("doc")).toBeNull();
  expect(text("reader-doc")).toContain("Loading…");
  expect(text("reader-head")).toContain("plan.md");

  fixture.resolve("plan.md", "the plan");
  await settle();
  expect(text("doc")).toBe("the plan");

  // A TAB PRESS: a new subject, so the waiting line comes back and the old
  // file is gone from under the new tab's name.
  setPath("notes.md");
  await settle();
  expect(text("doc")).toBeNull();
  expect(text("reader-doc")).toContain("Loading…");
  expect(text("reader-head")).toContain("notes.md");

  fixture.resolve("notes.md", "the notes");
  await settle();
  expect(text("doc")).toBe("the notes");

  // THE SAME PATH, read again (the source changed under it): the document is
  // already on screen, so the text stays up.
  setRevision(revision() + 1);
  await settle();
  expect(text("doc")).toBe("the notes");
  expect(text("reader-doc")).not.toContain("Loading…");

  fixture.resolve("notes.md", "the notes, kept");
  await settle();
  expect(text("doc")).toBe("the notes, kept");
});
