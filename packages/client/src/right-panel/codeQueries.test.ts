/** A CODE VIEW'S READS GO TO ITS SUBJECT'S HOST. A view about a worktree on
 *  one machine, drawn while the page shows another, must read the worktree's
 *  machine — every query and every change pulse — never the shown one. */

import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { Effect } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Every procedure call, as `<host>:<verb>`. */
  calls: [] as string[],
  /** Every pulse subscription, as the host whose stream was opened. */
  pulses: [] as string[],
  emit: [] as Array<() => void>,
}));

vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    isTransportError: () => false,
    unenrolledStreamCall: (proc: () => string) => {
      h.pulses.push(proc());
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
  // Each host's pulse is a procedure naming that host, so the test reads
  // which host's change stream a query opened.
  const stream = (host: HostKey) => ({
    unenrolled: () => encodeHostKey(host),
  });
  return {
    // The page shows host A throughout.
    activeHost: () => ({ kind: "local" }),
    padiRpcOf: rpc,
    padiMap: {
      live: () => true,
      entry: (host: HostKey) => ({
        streams: {
          subscribeRepoChange: stream(host),
          subscribeFileChange: stream(host),
        },
      }),
    },
  };
});

vi.mock("solid-sonner", () => ({ toast: { error: () => {} } }));

import { buildCodeQueries } from "./codeQueries";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("a Code view's query set", () => {
  it("reads its subject's host, not the host the page shows", async () => {
    const elsewhere: HostKey = { kind: "remote", target: "build-box" };
    const dispose = createRoot((dispose) => {
      const q = buildCodeQueries({
        subject: () => ({
          host: elsewhere,
          git: { kind: "repo", root: "/srv/code/kestrel", lister: "git" },
          terminalId: null,
        }),
        state: { codeMode: () => "browse", selectedFile: () => null },
        active: () => true,
      });
      void q.localStatus.pending();
      void q.allPaths.pending();
      return dispose;
    });
    await flush();
    for (const emit of h.emit) emit();
    await flush();

    const remote = encodeHostKey(elsewhere);
    expect(h.pulses.length).toBeGreaterThan(0);
    expect(h.pulses.every((host) => host === remote)).toBe(true);
    expect(h.calls).toContain(`${remote}:getStatus:local`);
    expect(h.calls).toContain(`${remote}:listAll`);
    expect(h.calls.every((call) => call.startsWith(`${remote}:`))).toBe(true);
    dispose();
  });
});
