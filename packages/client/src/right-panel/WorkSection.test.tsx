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
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Per-terminal fleet paint the section reads through the store. Mutable so a
 *  test can give two terminals different hues; `undefined` drops the section
 *  onto its `assignColors` fallback, which is the path with no store at all. */
const displayInfo = new Map<
  string,
  { repoColor: string; annotationColor: string }
>();

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getDisplayInfo: (id: TerminalId) =>
      displayInfo.get(id as unknown as string),
  }),
}));

const { default: WorkSection } = await import("./WorkSection");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  displayInfo.clear();
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

function mount(initial: TerminalMetadata, terminalId: TerminalId | null) {
  const [meta, setMeta] = createSignal(initial);
  host = document.createElement("div");
  document.body.append(host);
  const [id, setId] = createSignal(terminalId);
  dispose = render(() => <WorkSection meta={meta()} terminalId={id()} />, host);
  return { setMeta, setId };
}

const text = (testid: string) =>
  host?.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();

const el = (testid: string) =>
  host?.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

/** `--chip-hue` sits on the CHIP. For the branch that is the testid'd element
 *  itself; for the repo the testid is on the inner name span (the monogram
 *  glyph must stay out of its textContent), so climb to the chip frame. */
const hue = (chip: HTMLElement | null | undefined) =>
  chip?.style.getPropertyValue("--chip-hue");

describe("WorkSection identity chips", () => {
  it("repaints branch, repo, and directory when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG, null);

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
    const { setMeta } = mount(RESIZE_BUG, null);
    const branch = () =>
      host?.querySelector('[data-testid="inspector-branch"]');

    expect(branch()?.getAttribute("title")).toBe("worktree");
    expect(branch()?.querySelector("svg")).not.toBeNull();

    setMeta(PI);

    expect(branch()?.getAttribute("title")).toBeNull();
    expect(branch()?.querySelector("svg")).toBeNull();
  });

  it("repaints the fleet hues when the terminal switches", () => {
    const a = "resize" as unknown as TerminalId;
    const b = "pi" as unknown as TerminalId;
    displayInfo.set(a as unknown as string, {
      repoColor: "oklch(0.7 0.1 20)",
      annotationColor: "oklch(0.7 0.1 40)",
    });
    displayInfo.set(b as unknown as string, {
      repoColor: "oklch(0.7 0.1 200)",
      annotationColor: "oklch(0.7 0.1 240)",
    });

    const { setMeta, setId } = mount(RESIZE_BUG, a);
    const branchChip = () => el("inspector-branch");
    const repoChip = () => el("inspector-repo")?.parentElement;

    expect(hue(branchChip())).toBe("oklch(0.7 0.1 40)");
    expect(hue(repoChip())).toBe("oklch(0.7 0.1 20)");

    setId(b);
    setMeta(PI);

    expect(hue(branchChip())).toBe("oklch(0.7 0.1 240)");
    expect(hue(repoChip())).toBe("oklch(0.7 0.1 200)");
  });
});
