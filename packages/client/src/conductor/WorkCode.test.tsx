// @vitest-environment happy-dom
/** A PICKED WORK'S CODE VIEW — what it hands the one Code view, and when it
 *  reads. It is about the work's worktree on the work's host, borrowing the
 *  member standing in it or none; it reads only while it is mounted and the
 *  Conductor is shown; and a link opened in it lands in it, never in the
 *  Right panel. */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import type { Work, WorkId } from "kolu-work";
import { createSignal, flush, Show } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeDoor } from "../code-view/codeDoor";

const h = vi.hoisted(() => ({
  /** Every procedure call, as `<host>:<verb>`. */
  calls: [] as string[],
  /** Every change-pulse push, for a test to fire. */
  emit: [] as Array<() => void>,
  /** What each mounted Code view was handed. */
  tabs: [] as Array<{
    subject: () => unknown;
    door: CodeDoor;
  }>,
  /** Every arrangement a mounted Code view was handed, in order. */
  arrangements: [] as string[],
}));

vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import(
    "../code-view/streamMock.testlib"
  );
  return {
    isTransportError: () => false,
    unenrolledStreamCall: () => {
      const { stream, push } = makeControllableStream({});
      h.emit.push(() => push({ frame: true }));
      return stream;
    },
  };
});

vi.mock("../wire", () => {
  const rpc = (host: HostKey) => {
    const on = (verb: string) => h.calls.push(`${encodeHostKey(host)}:${verb}`);
    return {
      git: {
        getStatus: (i: { mode: string }) =>
          Effect.sync(() => {
            on(`getStatus:${i.mode}`);
            return { mode: i.mode, files: [] };
          }),
        getDiff: () => Effect.sync(() => on("getDiff")),
      },
      fs: {
        listAll: () =>
          Effect.sync(() => {
            on("listAll");
            return { paths: ["src/main.rs"] };
          }),
        listIgnored: () => Effect.sync(() => on("listIgnored")),
        listDirectory: () => Effect.sync(() => on("listDirectory")),
        readFile: () => Effect.sync(() => on("readFile")),
        filePreviewTag: () => Effect.sync(() => on("filePreviewTag")),
      },
    };
  };
  const stream = () => ({ unenrolled: () => "pulse" });
  const none = { use: () => ({ keys: () => [], byKey: () => undefined }) };
  return {
    activeHost: () => ({ kind: "local" }),
    padiRpcOf: rpc,
    padiMap: {
      live: () => true,
      entry: () => ({
        streams: {
          subscribeRepoChange: stream(),
          subscribeFileChange: stream(),
        },
      }),
    },
    app: {
      collections: { workCodeViews: none, works: none },
      procedures: {
        conductor: { setWorkCodeView: () => Effect.void },
      },
    },
  };
});
vi.mock("solid-sonner", () => ({ toast: { error: () => {} } }));
// The Right panel's own door is only read here, never opened.
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({}),
}));
vi.mock("../right-panel/useRightPanel", () => ({ useRightPanel: () => ({}) }));
// The one Code view, as a recorder: it leases the query set it is handed
// exactly as the real one does, watches one read as its badge would, and
// keeps the rest for the test to read.
vi.mock("../code-view/CodeTab", async () => {
  const { useShown } = await import("../ui/shown");
  const { createRenderEffect } = await import("solid-js");
  return {
    default: (props: {
      subject: unknown;
      queries: {
        lease: (shown: () => boolean) => void;
        localStatus: { pending: () => boolean };
      };
      door: CodeDoor;
      arrangement: string;
    }) => {
      props.queries.lease(useShown());
      h.tabs.push({ subject: () => props.subject, door: props.door });
      createRenderEffect(
        () => props.arrangement,
        (arrangement) => {
          h.arrangements.push(arrangement);
        },
      );
      return (
        <div data-testid="code-tab">
          {String(props.queries.localStatus.pending())}
        </div>
      );
    },
  };
});
import { codeOwner } from "../code-view/codeTabOpenController";
import { pendingOpen } from "../right-panel/openInCodeTab";
import { Shown } from "../ui/shown";
import type { MemberLine } from "./workFacts";
import WorkCode from "./WorkCode";

const WORKTREE = "/srv/code/kestrel/.worktrees/export";
const INSIDE = "22222222-2222-4222-8222-222222222222";
const ID = "w-export" as WorkId;

const workOn = (worktree: Work["worktree"]): Work => ({
  key: {
    kind: "branch",
    host: "remote:build-box",
    repo: "/srv/code/kestrel",
    branch: "feat/export",
    repoBy: { kind: "git" },
  },
  title: "Export the ledger",
  events: [],
  decisions: [],
  startedAt: "2026-01-01T09:00:00.000Z",
  state: { kind: "open" },
  worktree,
});
const readWork = workOn({
  kind: "at",
  path: WORKTREE,
});

/** A member terminal on the work's host, standing in the worktree. */
const inside: MemberLine = {
  terminal: `remote:build-box/${INSIDE}`,
  member: { work: ID, role: "implementor" } as never,
  split: { host: "remote:build-box", id: INSIDE },
  standing: {
    kind: "here",
    meta: {
      state: "active",
      cwd: WORKTREE,
      git: {
        kind: "repo",
        info: {
          repoRoot: WORKTREE,
          repoName: "kestrel",
          worktreePath: WORKTREE,
          branch: "feat/export",
          isWorktree: true,
          mainRepoRoot: "/srv/code/kestrel",
          remoteUrl: null,
          isBare: false,
        },
      },
    },
  } as never,
};

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

let dispose: (() => void) | undefined;
beforeEach(() => {
  h.calls = [];
  h.emit = [];
  h.tabs = [];
  h.arrangements = [];
});
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const mount = (body: () => JSX.Element, shown: () => boolean = () => true) => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <Shown value={shown}>{body()}</Shown>, host);
};

describe("a picked work's Code view", () => {
  it("says in one line that the worktree is unread, and draws no view", () => {
    mount(() => (
      <WorkCode id={ID} work={workOn({ kind: "unread" })} members={[]} />
    ));
    expect(
      document.querySelector("[data-testid=work-code-unread]")?.textContent,
    ).toBe("kolu has not read where this work is working yet.");
    expect(h.tabs).toHaveLength(0);
  });

  it("says in one line that the branch is checked out nowhere, never that it is unread", () => {
    mount(() => (
      <WorkCode id={ID} work={workOn({ kind: "absent" })} members={[]} />
    ));
    expect(
      document.querySelector("[data-testid=work-code-absent]")?.textContent,
    ).toBe("This work's branch is not checked out anywhere on its host.");
    expect(document.querySelector("[data-testid=work-code-unread]")).toBeNull();
    expect(h.tabs).toHaveLength(0);
  });

  it("is about the worktree on the work's host, borrowing the member standing in it", () => {
    mount(() => <WorkCode id={ID} work={readWork} members={[inside]} />);
    expect(h.tabs[0]?.subject()).toEqual({
      owner: codeOwner("work", ID),
      host: { kind: "remote", target: "build-box" },
      git: { kind: "repo", root: WORKTREE, lister: "git" },
      terminalId: INSIDE,
      comments: { kind: "work", id: ID },
    });
  });

  it("with no terminal standing in it, is still the worktree, listed by git, borrowing none", () => {
    mount(() => <WorkCode id={ID} work={readWork} members={[]} />);
    expect(h.tabs[0]?.subject()).toEqual({
      owner: codeOwner("work", ID),
      host: { kind: "remote", target: "build-box" },
      git: { kind: "repo", root: WORKTREE, lister: "git" },
      terminalId: null,
      comments: { kind: "work", id: ID },
    });
  });

  it("reads the work's host only while Code is in front, and stops when it is not", async () => {
    const [front, setFront] = createSignal(true);
    mount(() => (
      <Show when={front()}>
        <WorkCode id={ID} work={readWork} members={[]} />
      </Show>
    ));
    await settle();
    for (const pulse of h.emit) pulse();
    await settle();
    expect(h.calls).toContain("remote:build-box:getStatus:local");
    expect(h.calls.every((call) => call.startsWith("remote:build-box:"))).toBe(
      true,
    );

    setFront(false);
    h.calls = [];
    for (const pulse of h.emit) pulse();
    await settle();
    expect(h.calls).toEqual([]);
  });

  it("reads nothing while the Conductor is not the shown view", async () => {
    mount(
      () => <WorkCode id={ID} work={readWork} members={[]} />,
      () => false,
    );
    await settle();
    for (const pulse of h.emit) pulse();
    await settle();
    expect(h.calls).toEqual([]);
  });

  it("opens a link in its own view, never in the Right panel's", () => {
    mount(() => <WorkCode id={ID} work={readWork} members={[inside]} />);
    const door = h.tabs[0]?.door;
    door?.open({
      ref: { path: "src/main.rs", startLine: 3, endLine: null },
      targetMode: "browse",
    });
    flush();
    expect(door?.pending()?.scope).toEqual({
      host: { kind: "remote", target: "build-box" },
      owner: codeOwner("work", ID),
      repoRoot: WORKTREE,
      mode: "browse",
    });
    expect(pendingOpen()).toBeNull();
  });

  it("is built beside on a wide box, never stacked first", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 600,
    } as DOMRect);
    mount(() => <WorkCode id={ID} work={readWork} members={[]} />);
    expect(h.arrangements).toEqual(["beside"]);
  });
});
