/**
 * The fs/git watcher-pulse logic, ported from the retired
 * `@kolu/terminal-vocab/serveFsGit` test when padi absorbed the two
 * change-pulse stream sources. Driven by a FAKE endpoint whose
 * `subscribeRepoChange` hands us the change callback — so seq / snapshot /
 * per-subscription behaviour is deterministic, with no real fs-watcher or
 * debounce timing (kolu-git's watcher firing is covered in kolu-git's own tests).
 */

import type { ChangePulse } from "@kolu/terminal-vocab/schema";
import { Stream } from "effect";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { TerminalEndpoint } from "./endpoint.ts";
import { padiFsDeps } from "./fsDeps.ts";

const log = pino({ level: "silent" });

const tick = () => new Promise((r) => setTimeout(r, 0));

/** The `{ source }` arm of a watcher stream's dep (we always build that arm).
 *  Effect-native now: a source returns a lazy `Stream`, and `toAsyncIterable`'s
 *  iterator is what RUNS it — which is also what installs the watcher, so the
 *  laziness is visible in these pulls rather than hidden behind an `await`. */
type PulseSource = {
  source: (input: { repoPath: string }) => Stream.Stream<ChangePulse>;
};

/** Pull-shaped view of a member stream — one bridge, used by both cases. */
const pulls = (stream: Stream.Stream<ChangePulse>) =>
  Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();

describe("padiFsDeps watcher pulses", () => {
  it("yields a {seq:0} snapshot, then an incrementing seq per change", async () => {
    const installed: Array<() => void> = [];
    const fakeEndpoint = {
      fs: {
        subscribeRepoChange: (_repoPath: string, onChange: () => void) => {
          installed.push(onChange);
          return () => {};
        },
      },
    } as unknown as TerminalEndpoint;
    const deps = padiFsDeps(fakeEndpoint, log);

    const itr = pulls(
      (deps.streams.subscribeRepoChange as PulseSource).source({
        repoPath: "/repo",
      }),
    );

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
    const fakeEndpoint = {
      fs: { subscribeRepoChange: () => () => {} },
    } as unknown as TerminalEndpoint;
    const deps = padiFsDeps(fakeEndpoint, log);
    const firstFrame = async (repoPath: string) =>
      (
        await pulls(
          (deps.streams.subscribeRepoChange as PulseSource).source({
            repoPath,
          }),
        ).next()
      ).value;

    // A shared (dep-level) counter would make the second subscription start at
    // 1; an independent per-subscription seq keeps both at 0.
    expect(await firstFrame("/a")).toEqual({ seq: 0 });
    expect(await firstFrame("/a")).toEqual({ seq: 0 });
  });
});
