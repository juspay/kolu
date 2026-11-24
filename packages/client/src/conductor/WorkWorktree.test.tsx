// @vitest-environment happy-dom
/**
 * A WORK'S WORKTREE PART hands the Right panel's Work section the work's own
 * folder — and its live branch and PR only from a member terminal standing IN
 * that folder. A member in another checkout speaks for that checkout, never
 * for this work; with none in the folder, the facts are the work's key's.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { Work } from "kolu-work";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkSubject } from "../right-panel/WorkSection";
import type { MemberLine } from "./workFacts";

const handed = vi.hoisted(() => ({ subject: null as unknown }));

// The section itself is the Right panel's, tested where it lives; what is
// pinned here is WHAT this part hands it.
vi.mock("../right-panel/WorkSection", () => ({
  default: (props: { subject: unknown }) => {
    handed.subject = props.subject;
    return <span data-testid="work-section-stub" />;
  },
}));
vi.mock("../right-panel/useOduLink", () => ({ useOduLink: () => undefined }));

import WorkWorktree from "./WorkWorktree";

const WORKTREE = "/srv/code/tidepool/.worktrees/csv";

const work: Work = {
  key: {
    kind: "branch",
    host: "local",
    repo: "/srv/code/tidepool",
    branch: "feat/csv-export",
  },
  title: "Add CSV export",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree: { kind: "read", host: "local", path: WORKTREE },
};

/** A member terminal on this host, standing in `repoRoot` on `branch`. */
const memberIn = (repoRoot: string, branch: string): MemberLine => ({
  terminal: `local/${branch}`,
  member: {
    work: "w",
    role: "implementor",
    joinedAt: "2026-01-01T00:00:00Z",
  } as never,
  split: { host: "local", id: branch },
  standing: {
    kind: "here",
    meta: {
      state: "active",
      cwd: repoRoot,
      git: {
        kind: "repo",
        info: {
          repoRoot,
          repoName: "tidepool",
          worktreePath: repoRoot,
          branch,
          isWorktree: true,
          mainRepoRoot: "/srv/code/tidepool",
          remoteUrl: null,
          isBare: false,
        },
      },
      location: LOCAL_LOCATION,
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
      lastActivityAt: 0,
      promptedAt: null,
    } as TerminalMetadata,
  },
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  handed.subject = null;
});

function subjectFor(members: ReadonlyArray<MemberLine>): WorkSubject {
  dispose = render(
    () => <WorkWorktree work={work} members={members} />,
    document.createElement("div"),
  );
  return handed.subject as WorkSubject;
}

describe("a work's worktree part", () => {
  it("reads the live branch off a member standing in the work's folder", () => {
    const subject = subjectFor([memberIn(WORKTREE, "feat/csv-export-live")]);
    expect(subject.directory).toBe(WORKTREE);
    expect(subject.git?.branch).toBe("feat/csv-export-live");
    expect(subject.git?.isWorktree).toBe(true);
  });

  it("never takes another checkout's branch for the work's own", () => {
    const subject = subjectFor([
      memberIn("/srv/code/tidepool/.worktrees/other", "fix-other"),
    ]);
    expect(subject.directory).toBe(WORKTREE);
    expect(subject.git?.branch).toBe("feat/csv-export");
    expect(subject.pr).toBeNull();
    // No git reading of THIS folder: whether it is a linked worktree is not
    // claimed.
    expect(subject.git?.isWorktree).toBeNull();
  });
});
