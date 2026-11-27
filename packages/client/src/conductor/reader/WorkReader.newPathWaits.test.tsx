// @vitest-environment happy-dom
/** A NEW PATH WAITS; THE SAME PATH KEEPS ITS DOCUMENT.
 *
 *  A tab press changes what the reader shows: the new tab's name goes up at
 *  once — the header and the tabs are never held waiting for a file — and the
 *  file that was open is NOT left sitting under it: the viewer, which stays
 *  mounted, draws its own pre-bytes line until the new file's bytes land. A
 *  second read of the SAME path (the work ends while the reader is open and
 *  the source becomes kolu's kept copy) is not a new document: the text stays
 *  on screen until the new bytes land. */

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
  // The one viewer, as the real one draws: the file's text once it has bytes,
  // and its own waiting line while it has none (the dispatcher's own `Switch`
  // fallback).
  default: (props: { file: { path: string; text?: string } | null }) => (
    <div data-testid="doc">{props.file?.text ?? "Loading…"}</div>
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
        // A read answers the file WITH THE PATH it was read for, as both of
        // the real sources do (`FileData.path`) — that is what tells a
        // document still on screen from the one the open tab asks for.
        const pending = Promise.withResolvers<{ path: string; text: string }>();
        fixture.reads.set(path, (text) => pending.resolve({ path, text }));
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
vi.mock("../useWorks", () => {
  // The one work this reader is pointed at. It carries the leaves the shared
  // record folds (`createWorkRecord`) — a key, a state and a worktree — so
  // the fold has something to read; what this file judges is the document.
  const WORK = {
    id: "w1",
    key: {
      kind: "branch",
      host: "local",
      repo: "/r",
      branch: "w1",
      repoBy: { kind: "git" },
    },
    title: "w1",
    events: [],
    decisions: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    state: { kind: "open" },
    worktree: { kind: "unread" },
  };
  return {
    useWorkMap: () => () => new Map([["w1", WORK]]),
    useWorkAt: (id: string) => (id === "w1" ? WORK : undefined),
    useWorkMembers: () => () => [],
  };
});
vi.mock("../workFacts", () => ({
  readWorkFacts: () => ({ members: () => [] }),
}));
vi.mock("../workReadings", () => ({ membersIn: () => [] }));
vi.mock("kolu-work", () => ({ openAsks: () => [] }));
vi.mock("../../comments/useComments", () => ({
  commentsFor: () => () => ({ commentsForPath: () => [] }),
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

  // The first read draws the viewer with no bytes yet — its own waiting line,
  // under a header that is already drawn: the page is not waiting on the
  // document.
  expect(text("doc")).toBe("Loading…");
  expect(text("reader-head")).toContain("plan.md");

  fixture.resolve("plan.md", "the plan");
  await settle();
  expect(text("doc")).toBe("the plan");

  // A TAB PRESS: a new subject, so the new name is up at once and the file
  // that was open is NOT under it — the viewer is back to its waiting line.
  setPath("notes.md");
  await settle();
  expect(text("doc")).toBe("Loading…");
  expect(text("reader-head")).toContain("notes.md");

  fixture.resolve("notes.md", "the notes");
  await settle();
  expect(text("doc")).toBe("the notes");

  // THE SAME PATH, read again (the source changed under it): the document is
  // already on screen, so the text stays up.
  setRevision(revision() + 1);
  await settle();
  expect(text("doc")).toBe("the notes");

  fixture.resolve("notes.md", "the notes, kept");
  await settle();
  expect(text("doc")).toBe("the notes, kept");
});
