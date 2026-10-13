/**
 * The composed watchers' LIFETIME model (juspay/kolu#2286).
 *
 * This file pins reference counting and retirement ONLY — it never touches a
 * real repo. The four upstream primitives are mocked to a counter, so an
 * "install" here means "`compose` asked its upstreams to watch" and a "retire"
 * means "`compose` dropped them", which is exactly what the issue's `git:
 * repo-change watcher installed` / `... retired` log grep measures in prod.
 * Real inotify/FSEvents delivery is covered by `index.test.ts` and
 * `working-tree-watcher.*.test.ts`; duplicating it here would buy flakiness and
 * no coverage.
 *
 * WHY `vi.useFakeTimers()` RATHER THAN AN INJECTED TIMER. padi's grace periods
 * take a `ScheduleTimer` dep because their owners (`attention/stateWatch.ts`)
 * are already built through a dep record that the fixture substitutes. This
 * layer has no such seam: `subscribeRepoChange` is a free function over
 * module-scope registries, reached from padi through two pass-throughs that
 * carry a repo path and a callback and nothing else. Threading a timer dep down
 * that chain would add an injection parameter to make one `setTimeout`
 * testable, which is the knob this repo's philosophy rejects.
 * Fake timers reach it with none of that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The mocked upstream watcher primitive — one `install`/`uninstall` tally
 *  shared by all four axes, plus the change callbacks so a test can fire one. */
const upstream = vi.hoisted(() => {
  const state = { installs: 0, uninstalls: 0, ticks: [] as Array<() => void> };
  return {
    state,
    install: (_repoRoot: string, onChange: () => void) => {
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

/** Captured `log.info` messages — the issue's measurement greps these exact
 *  strings, so the test asserts on the message text, not on a call count. */
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

/** A fresh repo path per test — the registries are module scope, so reusing one
 *  path would let a previous test's entry answer this one's first reference. */
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
  // Drain any entry still sitting in its grace window so it cannot survive into
  // the next test's counts, then hand the timers back.
  vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS * 2);
  vi.useRealTimers();
});

describe("repo-change watcher lifetime", () => {
  it("a client re-key costs zero installs and zero retires", () => {
    const stop = subscribeRepoChange(repo, () => {}, log);
    expect(upstream.state.installs).toBe(4);
    expect(installs()).toBe(1);
    stop();

    // The Code tab's focus-driven re-key: unsubscribe the repo and immediately
    // re-subscribe it, twenty times over. Before #2286 each lap tore down four
    // inotify watchers and built four more.
    for (let i = 0; i < 20; i += 1) {
      const again = subscribeRepoChange(repo, () => {}, log);
      again();
    }

    expect(upstream.state.installs).toBe(4);
    expect(upstream.state.uninstalls).toBe(0);
    expect(installs()).toBe(1);
    expect(retires()).toBe(0);
    expect(_sharedRepoChangeCount()).toBe(1);
  });

  it("the last reference retires only after the grace window", () => {
    subscribeRepoChange(repo, () => {}, log)();

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
    subscribeRepoChange(repo, () => {}, log)();
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS / 2);

    const stop = subscribeRepoChange(repo, () => {}, log);
    // Well past the original deadline: the cancelled timer must not fire.
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS * 2);
    expect(retires()).toBe(0);
    expect(installs()).toBe(1);
    expect(upstream.state.uninstalls).toBe(0);

    // And the re-armed window still retires once the new reference leaves.
    stop();
    vi.advanceTimersByTime(WATCHER_RETIRE_GRACE_MS);
    expect(retires()).toBe(1);
    expect(upstream.state.uninstalls).toBe(4);
  });
  it("file-change entries share the same grace window", () => {
    const stop = subscribeFileChange(repo, "a.txt", () => {}, log);
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
