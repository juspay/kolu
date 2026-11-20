import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => {
  const state = { installs: 0, uninstalls: 0, ticks: [] as Array<() => void> };
  return {
    state,
    install: (_repoRoot: string, _askers: unknown, onChange: () => void) => {
      state.installs += 1;
      state.ticks.push(onChange);
      return () => {
        state.uninstalls += 1;
      };
    },
  };
});

vi.mock("./head-watcher.ts", () => ({ watchGitHead: upstream.install }));
vi.mock("./reflog-watcher.ts", () => ({ watchGitReflog: upstream.install }));
vi.mock("./index-watcher.ts", () => ({ watchGitIndex: upstream.install }));
vi.mock("./working-tree-watcher.ts", () => ({
  watchWorkingTree: upstream.install,
}));

import type { Logger } from "kolu-shared";
import {
  _sharedFileChangeCount,
  _sharedRepoChangeCount,
  subscribeFileChange,
  subscribeRepoChange,
  WATCHER_RETIRE_GRACE_MS,
} from "./repo-change.ts";

const lines: string[] = [];
const log = {
  info: (_fields: unknown, msg: string) => lines.push(msg),
  error: () => {},
  warn: () => {},
  debug: () => {},
} as unknown as Logger;

const installs = (): number =>
  lines.filter((l) => l === "git: repo-change watcher installed").length;
const retires = (): number =>
  lines.filter((l) => l === "git: repo-change watcher retired").length;

let repo = "";
let seq = 0;

beforeEach(() => {
  vi.useFakeTimers();
  upstream.state.installs = 0;
  upstream.state.uninstalls = 0;
  upstream.state.ticks.length = 0;
  lines.length = 0;
  seq += 1;
  repo = `/fake/repo-${seq}`;
});

afterEach(() => {
  vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS * 2);
  vi.useRealTimers();
});

describe("repo-change watcher lifetime", () => {
  it("a client re-key costs zero installs and zero retires", () => {
    const stop = subscribeRepoChange(repo, "test", () => {}, log);
    expect(upstream.state.installs).toBe(4);
    expect(installs()).toBe(1);
    stop();

    for (let i = 0; i < 20; i += 1) {
      const again = subscribeRepoChange(repo, "test", () => {}, log);
      again();
    }

    expect(upstream.state.installs).toBe(4);
    expect(upstream.state.uninstalls).toBe(0);
    expect(installs()).toBe(1);
    expect(retires()).toBe(0);
    expect(_sharedRepoChangeCount()).toBe(1);
  });

  it("the last reference retires only after the grace window", () => {
    subscribeRepoChange(repo, "test", () => {}, log)();

    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS - 1);
    expect(retires()).toBe(0);
    expect(upstream.state.uninstalls).toBe(0);
    expect(_sharedRepoChangeCount()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(retires()).toBe(1);
    expect(upstream.state.uninstalls).toBe(4);
    expect(_sharedRepoChangeCount()).toBe(0);
  });

  it("a reference acquired inside the grace window cancels the retirement", () => {
    subscribeRepoChange(repo, "test", () => {}, log)();
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS / 2);

    const stop = subscribeRepoChange(repo, "test", () => {}, log);
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS * 2);
    expect(retires()).toBe(0);
    expect(installs()).toBe(1);
    expect(upstream.state.uninstalls).toBe(0);

    stop();
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS);
    expect(retires()).toBe(1);
    expect(upstream.state.uninstalls).toBe(4);
  });
  it("file-change entries share the same grace window", () => {
    const stop = subscribeFileChange(repo, "a.txt", "test", () => {}, log);
    stop();
    expect(_sharedFileChangeCount()).toBe(1);
    expect(
      lines.filter((l) => l === "git: file-change watcher retired"),
    ).toHaveLength(0);

    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS);
    expect(_sharedFileChangeCount()).toBe(0);
    expect(
      lines.filter((l) => l === "git: file-change watcher retired"),
    ).toHaveLength(1);
  });
});
