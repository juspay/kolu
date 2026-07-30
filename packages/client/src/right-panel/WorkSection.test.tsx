// @vitest-environment happy-dom
/**
 * The Work cluster must repaint when the ACTIVE TERMINAL changes.
 *
 * The Inspector is mounted ONCE and fed a changing `meta` prop — `RightPanel`
 * keeps both tabs alive and only `display:none`s the inactive one, so nothing
 * ever remounts this section on a terminal switch. Every chip therefore has to
 * read its value reactively; a value snapshotted into a `const` at first render
 * freezes for the life of the panel.
 *
 * That is exactly what shipped: `Show when={git && colors()}` narrowed to the
 * colours and the body then did `const git = props.meta.git!`, so branch + repo
 * pinned to whichever terminal painted first and never moved again, while the
 * directory line right beneath them (read inline in JSX) kept updating.
 *
 * So these tests switch the terminal and assert the chips CHANGED. The existing
 * e2e seam asserts only that `inspector-branch` is non-empty, which stale text
 * satisfies — non-emptiness is not the property that broke.
 */

import { LOCAL_LOCATION, type TerminalMetadata } from "@kolu/padi/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import WorkSection from "./WorkSection";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function terminal(git: {
  repoName: string;
  branch: string;
  isWorktree?: boolean;
  cwd: string;
}): TerminalMetadata {
  return {
    state: "active",
    cwd: git.cwd,
    git: {
      repoRoot: git.cwd,
      repoName: git.repoName,
      worktreePath: git.cwd,
      branch: git.branch,
      isWorktree: git.isWorktree ?? false,
      mainRepoRoot: `/home/srid/code/${git.repoName}`,
      remoteUrl: null,
    },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 0,
  };
}

/** The two terminals from the field report: the Inspector painted `resize-bug`
 *  / `kolu` first, then kept showing it while the user switched to `pi`. */
const RESIZE_BUG = terminal({
  repoName: "kolu",
  branch: "resize-bug",
  isWorktree: true,
  cwd: "/home/srid/code/kolu/.worktrees/resize-bug",
});
const PI = terminal({
  repoName: "AI",
  branch: "docs/pesu-chat-rewrite",
  cwd: "/home/srid/code/AI/.worktrees/pi",
});

function mount(initial: TerminalMetadata) {
  const [meta, setMeta] = createSignal(initial);
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <WorkSection meta={meta()} />, host);
  return { setMeta };
}

const text = (testid: string) =>
  host?.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();

const el = (testid: string) =>
  host?.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

/** `--chip-hue` sits on the CHIP FRAME — `inspector-branch` is the frame, and
 *  the repo frame carries `inspector-repo-chip` (its `inspector-repo` testid is
 *  on the inner name span, so the monogram glyph stays out of the textContent
 *  a reader asking "what repo?" gets). Both are queried directly. */
const hue = (testid: string) =>
  el(testid)?.style.getPropertyValue("--chip-hue");

describe("WorkSection identity chips", () => {
  it("repaints branch, repo, and directory when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG);

    expect(text("inspector-branch")).toBe("resize-bug");
    expect(text("inspector-repo")).toBe("kolu");
    expect(text("inspector-directory")).toBe(
      "/home/srid/code/kolu/.worktrees/resize-bug",
    );

    setMeta(PI);

    // The directory is read inline in JSX and has always updated — assert it
    // FIRST so a harness that simply never re-rendered fails here rather than
    // letting the chip assertions below pass for the wrong reason.
    expect(text("inspector-directory")).toBe(
      "/home/srid/code/AI/.worktrees/pi",
    );
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
    expect(text("inspector-repo")).toBe("AI");
  });

  it("drops the worktree glyph when switching to a non-worktree terminal", () => {
    const { setMeta } = mount(RESIZE_BUG);
    const branch = () =>
      host?.querySelector('[data-testid="inspector-branch"]');

    expect(branch()?.getAttribute("title")).toBe("worktree");
    expect(branch()?.querySelector("svg")).not.toBeNull();

    setMeta(PI);

    expect(branch()?.getAttribute("title")).toBeNull();
    expect(branch()?.querySelector("svg")).toBeNull();
  });

  /** Paint is derived from the git NAMES alone (`assignColors`, a pure
   *  function of the key string) — the same derivation the dock's fleet-wide
   *  projection feeds on, so the chips and the dock agree by construction and
   *  there is no store to stub. Asserting against real hues rather than
   *  hand-written strings is the point: a mocked `getDisplayInfo` proved
   *  forwarding, not paint. */
  it("repaints BOTH fleet hues from the git names when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG);

    const first = {
      branch: hue("inspector-branch"),
      repo: hue("inspector-repo-chip"),
    };
    expect(first.branch).toMatch(/^oklch\(/);
    expect(first.repo).toMatch(/^oklch\(/);

    setMeta(PI);

    const second = {
      branch: hue("inspector-branch"),
      repo: hue("inspector-repo-chip"),
    };
    expect(second.branch).toMatch(/^oklch\(/);
    expect(second.repo).toMatch(/^oklch\(/);
    // BOTH must move. The bug pinned the first terminal's pair for the life of
    // the panel, so a single-hue assertion would not have caught it.
    expect(second.branch).not.toBe(first.branch);
    expect(second.repo).not.toBe(first.repo);

    // And the hue is a STABLE function of the name, not of the co-set: a fresh
    // mount of the first terminal repaints the original pair exactly.
    dispose?.();
    host?.remove();
    mount(RESIZE_BUG);
    expect(hue("inspector-branch")).toBe(first.branch);
    expect(hue("inspector-repo-chip")).toBe(first.repo);
  });
});
