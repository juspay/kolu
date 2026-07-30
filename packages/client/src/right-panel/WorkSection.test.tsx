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

type ActivePr = Extract<TerminalMetadata, { state: "active" }>["pr"];

function terminal(git: {
  repoName: string;
  branch: string;
  isWorktree?: boolean;
  cwd: string;
  pr?: ActivePr;
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
    pr: git.pr ?? { kind: "absent" },
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

  /** The monogram is deliberately OUTSIDE the `inspector-repo` testid (its glyph
   *  would otherwise read as "Kkolu"), which means the name and hue assertions
   *  above cannot see it. Snapshot `RepoMonogram`'s `group` and they would all
   *  still pass while the visible glyph stayed on the previous repo. */
  it("repaints the repo monogram glyph when the terminal switches", () => {
    const { setMeta } = mount(RESIZE_BUG);
    const glyph = () =>
      el("inspector-repo-chip")
        ?.querySelector(".repo-monogram")
        ?.textContent?.trim();

    expect(glyph()).toBe("K");

    setMeta(PI);

    expect(glyph()).toBe("A");
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

/** The PR/CI half of the cluster reaches through the same one-memo-one-accessor
 *  shape the git half does, so it can freeze the same way — and the identity
 *  tests above would stay green while it did, because every fixture there has
 *  `pr: absent`. These pin the whole PR path across a switch: link, number,
 *  title, rollup, and the per-check list. */
describe("WorkSection PR and CI", () => {
  const GREEN = terminal({
    repoName: "kolu",
    branch: "resize-bug",
    cwd: "/home/srid/code/kolu/.worktrees/resize-bug",
    pr: {
      kind: "ok",
      value: {
        number: 2037,
        title: "Repo identity paints the same way across Kolu",
        state: "open",
        url: "https://github.test/pull/2037",
        checks: "pass",
        checkRuns: [
          { name: "ci::biome", outcome: "pass" },
          { name: "ci::nix", outcome: "pass" },
        ],
      },
    },
  });
  const RED = terminal({
    repoName: "AI",
    branch: "docs/pesu-chat-rewrite",
    cwd: "/home/srid/code/AI/.worktrees/pi",
    pr: {
      kind: "ok",
      value: {
        number: 2072,
        title: "Inspector chips follow the terminal you're on",
        state: "open",
        url: "https://github.test/pull/2072",
        checks: "fail",
        checkRuns: [
          { name: "ci::typecheck", outcome: "fail" },
          { name: "ci::e2e", outcome: "pending" },
          { name: "ci::biome", outcome: "pass" },
        ],
      },
    },
  });

  const prLink = () => host?.querySelector<HTMLAnchorElement>("a[href]");
  const checkNames = () =>
    [
      ...(host?.querySelectorAll('[data-testid="inspector-pr-checks"] li') ??
        []),
    ]
      .map((li) => li.textContent?.trim())
      .filter(Boolean);

  it("repaints link, number, title, rollup, and check list on a switch", () => {
    const { setMeta } = mount(GREEN);

    expect(prLink()?.getAttribute("href")).toBe(
      "https://github.test/pull/2037",
    );
    expect(prLink()?.textContent).toContain("#2037");
    expect(text("inspector-ci")).toBe("✓ 2 passed");
    expect(checkNames()).toEqual(["ci::biome", "ci::nix"]);

    setMeta(RED);

    expect(prLink()?.getAttribute("href")).toBe(
      "https://github.test/pull/2072",
    );
    expect(prLink()?.textContent).toContain("#2072");
    // The rollup's VERDICT and its COUNT come out of one read, so they can
    // never describe two different PRs — a green tally under a red verdict.
    expect(text("inspector-ci")).toBe("✕ 1 failed");
    // Exceptions sort first.
    expect(checkNames()).toEqual(["ci::typecheck", "ci::e2e", "ci::biome"]);
    expect(host?.textContent).toContain(
      "Inspector chips follow the terminal you're on",
    );
    expect(host?.textContent).not.toContain(
      "Repo identity paints the same way",
    );
  });

  it("clears the whole PR cluster when switching to a terminal without one", () => {
    const { setMeta } = mount(GREEN);
    expect(el("inspector-ci")).not.toBeNull();

    setMeta(PI);

    expect(prLink()).toBeNull();
    expect(el("inspector-ci")).toBeNull();
    expect(el("inspector-pr-checks")).toBeNull();
    expect(host?.textContent).not.toContain(
      "Repo identity paints the same way",
    );
    // The identity half must still have followed the switch.
    expect(text("inspector-branch")).toBe("docs/pesu-chat-rewrite");
  });
});
