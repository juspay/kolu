import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryChannelByName } from "@kolu/surface/server";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTerminalWorkspaceEndpoint,
  type TerminalEndpointFs,
  type TerminalEndpointGit,
} from "./endpoint.ts";
import { makeTempRepo } from "./gitRepo.testlib.ts";
import { writeScratchFile } from "./scratch.ts";
import { fsGitSurfaceDeps } from "./serveFsGit.ts";
import {
  quietActivity,
  serveTerminalWorkspace,
} from "./serveTerminalWorkspace.ts";
import { type RepoChangePulse, terminalWorkspaceSurface } from "./surface.ts";

const log = pino({ level: "silent" });
const TERM_ID = "11111111-1111-4111-8111-111111111111";

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
//    factory + endpoint against a temp git repo (the same assembly kolu-server
//    and pulam use), so the byte primitives are exercised through the actual
//    serve path, not just the endpoint method.
function makeClient(scratchRoot: string) {
  const { router } = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    ...serveTerminalWorkspace({
      snapshots: {
        readAll: () => new Map(),
        upsert: () => {},
        remove: () => {},
      },
      activity: quietActivity,
      endpoint: createTerminalWorkspaceEndpoint(log),
      scratchWrite: ({ terminalId, name, dataBase64 }) => ({
        path: writeScratchFile(scratchRoot, terminalId, name, dataBase64),
      }),
      log,
    }),
  });
  return directLink<typeof terminalWorkspaceSurface.contract>(router);
}

describe("terminalWorkspaceSurface served over directLink", () => {
  let repo: string;
  let scratchRoot: string;
  beforeEach(() => {
    repo = makeTempRepo();
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-scratch-"));
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("forwards fs.listAll", async () => {
    const { paths } = await makeClient(scratchRoot).surface.fs.listAll({
      repoPath: repo,
    });
    expect(paths).toContain("a.txt");
  });

  it("forwards git.getStatus", async () => {
    const out = await makeClient(scratchRoot).surface.git.getStatus({
      repoPath: repo,
      mode: "local",
    });
    expect(out.files.some((f) => f.path === "a.txt")).toBe(true);
  });

  it("the repo-change watcher's first frame is the {seq:0} snapshot", async () => {
    const first = await firstFrameOrUndefined(
      await makeClient(scratchRoot).surface.subscribeRepoChange.get({
        repoPath: repo,
      }),
    );
    expect(first).toEqual({ seq: 0 });
  });

  // ── The R9.5 byte primitives, served in-process over the real assembly ──
  it("serves fs.previewRead — bytes + content-type for a repo file", async () => {
    const r = await makeClient(scratchRoot).surface.fs.previewRead({
      repoPath: repo,
      filePath: "a.txt",
      range: null,
    });
    expect(r.status).toBe(200);
    expect(Buffer.from(r.bodyBase64, "base64").toString("utf8")).toBe(
      "one\ntwo\n",
    );
    expect(r.headers["Content-Type"]).toContain("text/plain");
  });

  it("serves scratch.write — writes the dropped file and returns its path", async () => {
    const out = await makeClient(scratchRoot).surface.scratch.write({
      terminalId: TERM_ID,
      name: "drop.txt",
      dataBase64: Buffer.from("dropped").toString("base64"),
    });
    expect(out.path).toBe(path.join(scratchRoot, TERM_ID, "drop.txt"));
    expect(fs.readFileSync(out.path, "utf8")).toBe("dropped");
  });

  it("serves transcript.read — the full source under a store root", async () => {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-store-"));
    fs.writeFileSync(path.join(store, "s.jsonl"), '{"x":1}\n');
    try {
      const out = await makeClient(scratchRoot).surface.transcript.read({
        root: store,
        path: "s.jsonl",
      });
      expect(out.content).toBe('{"x":1}\n');
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });
});
