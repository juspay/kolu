import fs from "node:fs";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTerminalWorkspaceEndpoint,
  type TerminalEndpointFs,
  type TerminalEndpointGit,
} from "./endpoint.ts";
import { makeTempRepo } from "./gitRepo.testlib.ts";
import { fsGitSurfaceDeps } from "./serveFsGit.ts";
import {
  DEFAULT_CONNECTION,
  DEFAULT_VERSION,
  type RepoChangePulse,
  terminalWorkspaceSurface,
} from "./surface.ts";

const log = pino({ level: "silent" });

/** The `{ source }` arm of a watcher stream's dep (we always build that arm). */
type PulseSource = {
  source: (
    input: { repoPath: string },
    signal: AbortSignal | undefined,
  ) => AsyncIterable<RepoChangePulse>;
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// ── The pulse logic, driven by a FAKE endpoint whose `subscribeRepoChange`
//    hands us the change callback — so seq/snapshot/per-subscription behaviour
//    is deterministic, with no real fs-watcher or debounce timing. (kolu-git's
//    watcher firing is covered in kolu-git's own tests.)
describe("fsGitSurfaceDeps watcher pulses", () => {
  it("yields a {seq:0} snapshot, then an incrementing seq per change", async () => {
    const installed: Array<() => void> = [];
    const fakeFs = {
      subscribeRepoChange: (_repoPath: string, onChange: () => void) => {
        installed.push(onChange);
        return () => {};
      },
    } as unknown as TerminalEndpointFs;
    const deps = fsGitSurfaceDeps(
      { fs: fakeFs, git: {} as TerminalEndpointGit },
      log,
    );

    const itr = (deps.streams.subscribeRepoChange as PulseSource)
      .source({ repoPath: "/repo" }, undefined)
      [Symbol.asyncIterator]();

    // First frame is the snapshot pulse (snapshot-then-deltas).
    expect((await itr.next()).value).toEqual({ seq: 0 });

    // The second pull begins the for-await loop, which installs the watcher.
    const next = itr.next();
    for (let i = 0; i < 100 && installed.length === 0; i++) await tick();
    expect(installed).toHaveLength(1);

    installed[0]?.(); // one change fires one distinct pulse
    expect((await next).value).toEqual({ seq: 1 });
  });

  it("gives each subscription its OWN seq sequence (each starts at 0)", async () => {
    const fakeFs = {
      subscribeRepoChange: () => () => {},
    } as unknown as TerminalEndpointFs;
    const deps = fsGitSurfaceDeps(
      { fs: fakeFs, git: {} as TerminalEndpointGit },
      log,
    );
    const firstFrame = async (repoPath: string) =>
      (
        await (deps.streams.subscribeRepoChange as PulseSource)
          .source({ repoPath }, undefined)
          [Symbol.asyncIterator]()
          .next()
      ).value;

    // A shared (dep-level) counter would make the second subscription start at
    // 1; an independent per-subscription seq keeps both at 0.
    expect(await firstFrame("/a")).toEqual({ seq: 0 });
    expect(await firstFrame("/a")).toEqual({ seq: 0 });
  });
});

// ── The served surface end-to-end over an in-process directLink, with the REAL
//    endpoint against a temp git repo.
function makeClient() {
  const deps = fsGitSurfaceDeps(createTerminalWorkspaceEndpoint(log), log);
  const { router } = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: {
      version: { store: inMemoryStore(DEFAULT_VERSION) },
      connection: { store: inMemoryStore(DEFAULT_CONNECTION) },
    },
    collections: {
      awareness: {
        readAll: () => new Map(),
        upsert: () => {},
        remove: () => {},
      },
    },
    streams: {
      activity: {
        source: async function* (): AsyncGenerator<never> {},
      },
      ...deps.streams,
    },
    procedures: deps.procedures,
  });
  return directLink<typeof terminalWorkspaceSurface.contract>(router);
}

describe("terminalWorkspaceSurface served over directLink", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("forwards fs.listAll", async () => {
    const { paths } = await makeClient().surface.fs.listAll({ repoPath: repo });
    expect(paths).toContain("a.txt");
  });

  it("forwards git.getStatus", async () => {
    const out = await makeClient().surface.git.getStatus({
      repoPath: repo,
      mode: "local",
    });
    expect(out.files.some((f) => f.path === "a.txt")).toBe(true);
  });

  it("the repo-change watcher's first frame is the {seq:0} snapshot", async () => {
    const first = await firstFrameOrUndefined(
      await makeClient().surface.subscribeRepoChange.get({ repoPath: repo }),
    );
    expect(first).toEqual({ seq: 0 });
  });
});
