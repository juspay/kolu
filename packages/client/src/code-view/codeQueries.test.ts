/** A CODE VIEW'S READS GO TO ITS SUBJECT'S HOST. A view about a worktree on
 *  one machine, drawn while the page shows another, must read the worktree's
 *  machine — every query and every change pulse — never the shown one. */

import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { Effect } from "effect";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Every procedure call, as `<host>:<verb>`. */
  calls: [] as string[],
  /** Every pulse subscription, as `<host>#<pulse>`. */
  pulses: [] as string[],
  emit: [] as Array<() => void>,
  /** Every pulse subscription as a live handle: which stream it opened,
   *  whether its finalizer has run, and how to push a frame into it. */
  subs: [] as Array<{ proc: string; torn: boolean; emit: () => void }>,
}));

vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    isTransportError: () => false,
    unenrolledStreamCall: (proc: () => string) => {
      const name = proc();
      h.pulses.push(name);
      const sub = { proc: name, torn: false, emit: () => {} };
      const { stream, push } = makeControllableStream({
        onTeardown: () => {
          sub.torn = true;
        },
      });
      sub.emit = () => push({ frame: true });
      h.emit.push(sub.emit);
      h.subs.push(sub);
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
        readFile: (i: { filePath: string }) =>
          Effect.sync(() => {
            on("readFile");
            return { content: `bytes of ${i.filePath}`, truncated: false };
          }),
        filePreviewTag: () => Effect.sync(() => on("filePreviewTag")),
      },
    };
  };
  // Each host's pulse is a procedure naming that host AND which stream it is,
  // so the test reads both which host a query opened a pulse on and which
  // pulse went away.
  const stream = (host: HostKey, kind: string) => ({
    unenrolled: () => `${encodeHostKey(host)}#${kind}`,
  });
  return {
    // The page shows host A throughout.
    activeHost: () => ({ kind: "local" }),
    padiRpcOf: rpc,
    padiMap: {
      live: () => true,
      entry: (host: HostKey) => ({
        streams: {
          subscribeRepoChange: stream(host, "repo"),
          subscribeFileChange: stream(host, "file"),
        },
      }),
    },
  };
});

vi.mock("solid-sonner", () => ({ toast: { error: () => {} } }));

import { buildCodeQueries, createCodeLeases } from "./codeQueries";
import { codeOwner } from "./codeTabOpenController";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.calls.length = 0;
  h.pulses.length = 0;
  h.emit.length = 0;
  h.subs.length = 0;
});

describe("a Code view's query set", () => {
  it("reads its subject's host, not the host the page shows", async () => {
    const elsewhere: HostKey = { kind: "remote", target: "build-box" };
    const dispose = createRoot((dispose) => {
      const q = buildCodeQueries({
        subject: () => ({
          owner: codeOwner("test-view", "kestrel"),
          host: elsewhere,
          git: { kind: "repo", root: "/srv/code/kestrel", lister: "git" },
          terminalId: null,
          comments: null,
        }),
        state: { codeMode: () => "browse", selectedFile: () => null },
        active: () => true,
        showsPick: () => true,
      });
      void q.localStatus.pending();
      void q.allPaths.pending();
      return dispose;
    });
    await settle();
    for (const emit of h.emit) emit();
    await settle();

    const remote = encodeHostKey(elsewhere);
    expect(h.pulses.length).toBeGreaterThan(0);
    expect(h.pulses.every((proc) => proc.startsWith(`${remote}#`))).toBe(true);
    expect(h.calls).toContain(`${remote}:getStatus:local`);
    expect(h.calls).toContain(`${remote}:listAll`);
    expect(h.calls.every((call) => call.startsWith(`${remote}:`))).toBe(true);
    dispose();
  });
});

describe("the browse file-content read follows the SHOWN pick", () => {
  it("pauses when the tree stops showing the pick and resumes on the held value", async () => {
    const host: HostKey = { kind: "local" };
    const [shownPick, setShownPick] = createSignal<string | null>(
      "src/main.rs",
    );
    const fileSubs = () => h.subs.filter((sub) => sub.proc.endsWith("#file"));
    const reads = () => h.calls.filter((call) => call.endsWith(":readFile"));
    const emitAll = () => {
      for (const sub of h.subs) if (!sub.torn) sub.emit();
    };

    const done = await new Promise<{
      heldWhilePaused: unknown;
      pendingOnResume: boolean;
      valueOnResume: unknown;
      readsAfterPause: number;
      readsAfterResumeFrame: number;
      tornOnPause: boolean;
    }>((resolve) => {
      createRoot(async (dispose) => {
        const leases = createCodeLeases();
        const q = buildCodeQueries({
          subject: () => ({
            owner: codeOwner("test-view", "kestrel"),
            host,
            git: { kind: "repo", root: "/srv/code/kestrel", lister: "git" },
            terminalId: null,
            comments: null,
          }),
          // The STORED pick never moves: this is the condemnation the view
          // publishes, not a selection change.
          state: {
            codeMode: () => "browse",
            selectedFile: () => "src/main.rs",
          },
          active: leases.shown,
          showsPick: leases.showsPick,
        });
        leases.lease(() => true, shownPick);
        void q.fileContent.pending();
        await settle();
        emitAll();
        await settle();
        const landed = q.fileContent();

        // The tree stops showing the pick (it left the settled listing).
        setShownPick(null);
        await settle();
        const tornOnPause = fileSubs().every((sub) => sub.torn);
        const readsAtPause = reads().length;
        emitAll();
        await settle();
        const readsAfterPause = reads().length - readsAtPause;
        const heldWhilePaused = q.fileContent();

        // It comes back: the held answer shows with no blank, and the
        // resumed pulse's first frame refreshes it with exactly one read.
        setShownPick("src/main.rs");
        await settle();
        const valueOnResume = q.fileContent();
        const pendingOnResume = q.fileContent.pending();
        const readsAtResume = reads().length;
        emitAll();
        await settle();
        const readsAfterResumeFrame = reads().length - readsAtResume;

        expect(landed).toEqual({
          kind: "text",
          content: "bytes of src/main.rs",
          truncated: false,
        });
        resolve({
          heldWhilePaused,
          pendingOnResume,
          valueOnResume,
          readsAfterPause,
          readsAfterResumeFrame,
          tornOnPause,
        });
        dispose();
      });
    });

    // Paused: the file pulse is gone and no frame can reach the procedure.
    expect(done.tornOnPause).toBe(true);
    expect(done.readsAfterPause).toBe(0);
    expect(done.heldWhilePaused).toEqual({
      kind: "text",
      content: "bytes of src/main.rs",
      truncated: false,
    });
    // Resumed: the stamped answer stands (no blank), refreshed by ONE read.
    expect(done.pendingOnResume).toBe(false);
    expect(done.valueOnResume).toEqual({
      kind: "text",
      content: "bytes of src/main.rs",
      truncated: false,
    });
    expect(done.readsAfterResumeFrame).toBe(1);
  });
});
