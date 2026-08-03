/** Per-host Code-tab query OWNERSHIP + MOUNTING REALITY (padi W9's Code-tab half,
 *  completing W7's K1). The acceptance suite for `hostCodeTab`: each Code-tab query is
 *  ONE `createPolledQuery` per host, born inside a `scopedByEntry(padiMap, activeHost)`
 *  owner rooted at APP LIFETIME (`createSharedRoot`), with `active = ctx.isActive`.
 *
 *  Two properties are pinned here, the second of which the two confirmed defects
 *  violated:
 *   1. OWNERSHIP — a host's query state is retained across switch-away, PAUSED while
 *      backgrounded, RESUMED from its held value on switch-BACK (no blank), and disposed
 *      on membership exit.
 *   2. MOUNTING REALITY — the retained value survives a CONSUMER unmount/remount. This
 *      is the defect the review caught: the old `perHostPolledQuery` built its owner in
 *      the CONSUMER's reactive scope (BrowseFileDispatcher's keyed `<Show>`, CodeTab
 *      under the `canvasMode` `<Switch>`), so any tab unmount disposed the whole
 *      retention world. `hostCodeTab`'s owner is app-lifetime, so it does NOT.
 *      This test FAILS on that pre-fix shape (dispose the consumer → value gone → the
 *      remount asserts `pending` again); see the repo PR notes for the failing-first run.
 *
 *  Fixture: a REAL `scopedByEntry` over the shared mock `padiMap`
 *  (`hostScope/mockHostMap.testlib`), membership driven by `addHost`/`removeHost`, the
 *  active host by one module-stable signal. The Code-tab query inputs read the mocked
 *  `useTerminalStore().active()` + `useRightPanel()` (the active projection), and a
 *  hand-driven, procedure-and-input-keyed pulse (`unenrolledStreamCall` mocked)
 *  requeries the matching ACTIVE instance. */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { batch, createEffect, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PulseSubscription = {
  proc: unknown;
  input: string;
  emit: () => void;
};

// A multi-subscriber hand-driven pulse over the SHARED controllable stream mock.
// Subscriptions retain both the procedure identity and serialized input, so focused
// tests can emit one exact server event instead of broadcasting an indistinguishable
// generic pulse. A paused/re-keyed instance is INTERRUPTED, and the mock's finalizer
// (`onTeardown`) removes its subscription — the successor of the old abort listener.
const pulseCtl = vi.hoisted(() => ({
  repoProc: () => ({}),
  fileProc: () => ({}),
  subs: new Set<PulseSubscription>(),
}));
vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    unenrolledStreamCall: (proc: unknown, input: unknown) => {
      const sub: {
        proc: unknown;
        input: string;
        emit: () => void;
      } = { proc, input: JSON.stringify(input), emit: () => {} };
      const { stream, push } = makeControllableStream({
        onTeardown: () => pulseCtl.subs.delete(sub),
      });
      sub.emit = () => push({ frame: true });
      pulseCtl.subs.add(sub);
      return stream;
    },
  };
});

// The active projection the query inputs read — all controllable per test.
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
  repoRoot: (() => "/repo") as () => string | null,
  termId: (() => "t1") as () => string | null,
  mode: (() => "browse") as () => string,
  selected: (() => null) as () => string | null,
  // getStatus poll count, keyed by mode, so a "refresh" is observable per query.
  counts: {} as Record<string, number>,
  previewTagInputs: [] as Array<{ repoPath: string; filePath: string }>,
}));

vi.mock("../wire", async () => {
  const { mockPadiMap } = await import("../hostScope/mockHostMap.testlib");
  // The EFFECT-native procedures face. Each verb answers with a DESCRIPTION, so
  // the recorded side effects below run when the query is RUN — which is what
  // the call-count assertions are really about.
  const activePadiEffect = {
    git: {
      getStatus: (i: { repoPath: string; mode: string }) =>
        Effect.sync(() => {
          bag.counts[i.mode] = (bag.counts[i.mode] ?? 0) + 1;
          return {
            files: [],
            label: `${encodeHostKey(bag.activeHost())}:${i.mode}`,
            n: bag.counts[i.mode],
          };
        }),
      getDiff: () => Effect.succeed({ hunks: [] }),
    },
    fs: {
      listAll: () =>
        Effect.sync(() => {
          bag.counts.listAll = (bag.counts.listAll ?? 0) + 1;
          return { paths: ["src/app.ts"] };
        }),
      listIgnored: () => Effect.succeed({ paths: ["node_modules/"] }),
      readFile: () => Effect.succeed({ content: "", truncated: false }),
      filePreviewTag: (input: { repoPath: string; filePath: string }) =>
        Effect.sync(() => {
          bag.previewTagInputs.push(input);
          return "same-content-tag";
        }),
    },
  };
  // The un-enrolled change pulses ride the entry's STREAM face now
  // (`activePadiStreams.<pulse>.unenrolled`) — a no-op stream stub.
  const activePadiStreams = {
    subscribeRepoChange: { unenrolled: pulseCtl.repoProc },
    subscribeFileChange: { unenrolled: pulseCtl.fileProc },
  };
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    activePadiEffect,
    activePadiStreams,
  };
});

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    active: () => ({
      id: bag.termId(),
      meta: bag.repoRoot() ? { git: { repoRoot: bag.repoRoot() } } : null,
    }),
  }),
}));

vi.mock("./useRightPanel", () => ({
  useRightPanel: () => ({
    codeMode: () => bag.mode(),
    selectedFile: (_m: string) => bag.selected(),
  }),
}));

import {
  addHost,
  removeHost,
  resetHosts,
} from "../hostScope/mockHostMap.testlib";
import { codeAllPaths, codeFileContent, codeLocalStatus } from "./hostCodeTab";
import { setShowIgnoredFiles } from "./showIgnoredFiles";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pulse = () => {
  for (const sub of [...pulseCtl.subs]) sub.emit();
};
const filePulse = (input: { repoPath: string; filePath: string }) => {
  const serialized = JSON.stringify(input);
  for (const sub of [...pulseCtl.subs]) {
    if (sub.proc === pulseCtl.fileProc && sub.input === serialized) sub.emit();
  }
};
const liveFileInputs = () =>
  [...pulseCtl.subs]
    .filter((sub) => sub.proc === pulseCtl.fileProc)
    .map((sub) => JSON.parse(sub.input) as unknown);

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

// The mock `getStatus` returns a deliberately minimal shape carrying an identity
// `label` + poll count `n` (not the full `GitStatus`), so read it through this cast.
const read = () =>
  codeLocalStatus() as { label: string; n: number } | undefined;
const label = () => read()?.label;

beforeEach(() => {
  resetHosts();
  setDriveHost(HOST_A);
  bag.counts = {};
  bag.previewTagInputs = [];
  bag.mode = () => "browse";
  bag.selected = () => null;
  // Build the lazy app-lifetime owner (a real consumer reads the facade at mount) so the
  // `scopedByEntry` reactive graph is live and reacts to `switchTo` before the first pulse.
  void codeLocalStatus.pending();
});

describe("hostCodeTab — per-host query ownership (padi W9)", () => {
  it("retains each host's Code-tab query across switch-away, resumes with no blank, and refreshes on return", async () => {
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local"); // A's local-status instance loaded
    const aLoads = read()?.n ?? 0;

    // Switch AWAY to B: A pauses (value held), B builds + blanks until its pulse.
    switchTo(HOST_B);
    await flush();
    expect(codeLocalStatus.pending()).toBe(true); // B is fresh — blank
    pulse();
    await flush();
    expect(label()).toBe("remote:B:local"); // B loaded

    // Switch BACK to A: its instance was RETAINED, so A's held value shows with NO blank
    // (not pending) — the instant switch-back — then the pulse refreshes it.
    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(false); // resumed from held value, no blank
    expect(label()).toBe("local:local"); // A's retained value, instantly
    pulse();
    await flush();
    expect(read()?.n ?? 0).toBeGreaterThan(aLoads); // refreshed on activation
  });

  it("disposes a host's Code-tab query when it leaves the pool (a re-add rebuilds fresh)", async () => {
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local");

    // Move to B, then A leaves the pool: A's owner (and its query instances) disposes.
    switchTo(HOST_B);
    await flush();
    pulse();
    await flush();
    removeHost(HOST_A);
    await flush();

    // Re-add + re-visit A: scopedByEntry treats it as a FRESH member (its prior instance
    // was disposed on exit), so it rebuilds and blanks — the held value did NOT survive
    // membership exit (ownership: dropped when gone).
    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(true); // rebuilt fresh, not resurrected
  });

  it("retains the value across a CONSUMER unmount/remount — the app-lifetime owner (defect 1 + 2)", async () => {
    switchTo(HOST_A);
    await flush();

    // Consumer #1 mounts (a CodeTab/BrowseFileDispatcher stand-in): its OWN reactive
    // root subscribes the facade. It gets A's loaded value.
    let seen1: string | undefined;
    const dispose1 = createRoot((d) => {
      createEffect(() => {
        seen1 = read()?.label;
      });
      return d;
    });
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local");
    expect(seen1).toBe("local:local");

    // Consumer #1 UNMOUNTS — exactly what a `canvasMode` exit (CodeTab) or a keyed
    // `<Show>` re-key (BrowseFileDispatcher) does. On the pre-W9 component-scoped owner
    // this disposed the retention world; here the owner is app-lifetime, so it must not.
    dispose1();
    await flush();

    // Consumer #2 REMOUNTS and reads: the value SURVIVED the unmount — no blank, no
    // re-query needed. (Pre-fix, this reads `pending() === true` and the assertions fail.)
    let seen2: string | undefined;
    const dispose2 = createRoot((d) => {
      createEffect(() => {
        seen2 = read()?.label;
      });
      return d;
    });
    await flush();
    expect(codeLocalStatus.pending()).toBe(false); // retained through the unmount — no blank
    expect(label()).toBe("local:local");
    expect(seen2).toBe("local:local");
    dispose2();
  });

  it("a BACKGROUND host's Code-tab value survives while the active host's tab is unmounted (mode-transit wipe)", async () => {
    // Load A, then switch to B and load it.
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    switchTo(HOST_B);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("remote:B:local");

    // While B is active, its Code tab unmounts (B is a zero-terminal / warming host, so
    // `canvasMode` left `workspace` and the whole RightPanel came down). Simulate the
    // tab being absent: no consumer root is mounted at all. The OWNER is untouched.
    await flush();

    // Switch BACK to A: A was backgrounded (paused, frozen), so despite the active tab
    // having been unmounted, A's retained Code-tab value is intact — the pre-W9 bug
    // wiped EVERY host's state on that unmount.
    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(false);
    expect(label()).toBe("local:local");
  });

  it("a watcher pulse re-queries an unchanged preview tag without changing its URL", async () => {
    bag.selected = () => "report.html";
    switchTo(HOST_A);
    void codeFileContent.pending();
    await flush();

    const input = { repoPath: "/repo", filePath: "report.html" };
    expect(liveFileInputs()).toEqual([input]);
    filePulse(input);
    await flush();
    const before = codeFileContent();
    filePulse(input);
    await flush();
    const after = codeFileContent();

    expect(bag.previewTagInputs).toEqual([input, input]);
    expect(before).toEqual(after);
    expect(after).toMatchObject({
      kind: "binary",
      url: expect.stringContaining("?v=same-content-tag"),
    });
  });

  it("re-keys the file watcher when an in-preview navigation changes the selected path", async () => {
    const [selected, setSelected] = createSignal("dist/index.html");
    bag.selected = selected;
    switchTo(HOST_A);
    void codeFileContent.pending();
    await flush();

    const indexInput = { repoPath: "/repo", filePath: "dist/index.html" };
    const secondInput = { repoPath: "/repo", filePath: "dist/second.html" };
    expect(liveFileInputs()).toEqual([indexInput]);
    filePulse(indexInput);
    await flush();
    expect(bag.previewTagInputs).toEqual([indexInput]);

    setSelected("dist/second.html");
    await flush();
    expect(liveFileInputs()).toEqual([secondInput]);

    // An event for the old path is no longer connected; only the navigated-to
    // file can refresh the preview.
    filePulse(indexInput);
    filePulse(secondInput);
    await flush();
    expect(bag.previewTagInputs).toEqual([indexInput, secondInput]);
  });

  // The show-ignored toggle is a DISPLAY preference, so it must not disturb the
  // main file list. An earlier shape put it in `fs.listAll`'s input as an
  // `includeIgnored` flag, which joined that query's value key: every flip
  // blanked the whole list, which unmounts `<FileTree>` and remounts it with
  // `initialExpansion: "closed"` — losing every hand-expanded folder and the
  // scroll position. Splitting the ignored listing into its own idle-unless-on
  // query is what fixes it, and this pins that separation.
  it("flipping the show-ignored toggle leaves the main file list untouched — no blank, no re-query", async () => {
    switchTo(HOST_A);
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();

    const settled = codeAllPaths();
    expect(settled?.paths).toEqual(["src/app.ts"]);
    const queriesBefore = bag.counts.listAll;
    // Guard against a vacuous pass: if the mock were never reached, the
    // equality assertions below would compare `undefined` to `undefined`.
    expect(queriesBefore).toBeGreaterThan(0);

    setShowIgnoredFiles(true);
    await flush();

    // Same value object identity is not required, but the value must never go
    // absent (a blank) and the tracked listing must not be re-fetched.
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    expect(codeAllPaths.pending()).toBe(false);
    expect(bag.counts.listAll).toBe(queriesBefore);

    setShowIgnoredFiles(false);
    await flush();
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    expect(codeAllPaths.pending()).toBe(false);
    expect(bag.counts.listAll).toBe(queriesBefore);
  });
});
