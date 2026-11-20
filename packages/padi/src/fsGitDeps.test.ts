import type { RepoChangePulse } from "@kolu/terminal-vocab/schema";
import { Stream } from "effect";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { TerminalEndpoint } from "./endpoint.ts";
import { padiFsGitDeps } from "./fsGitDeps.ts";

const log = pino({ level: "silent" });

const tick = () => new Promise((r) => setTimeout(r, 0));

type PulseSource = {
  source: (input: { repoPath: string }) => Stream.Stream<RepoChangePulse>;
};

const pulls = (stream: Stream.Stream<RepoChangePulse>) =>
  Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();

describe("padiFsGitDeps watcher pulses", () => {
  it("yields a {seq:0} snapshot, then an incrementing seq per change", async () => {
    const installed: Array<() => void> = [];
    const fakeEndpoint = {
      fs: {
        subscribeRepoChange: (
          _repoPath: string,
          _asker: string,
          onChange: () => void,
        ) => {
          installed.push(onChange);
          return () => {};
        },
      },
    } as unknown as TerminalEndpoint;
    const deps = padiFsGitDeps(fakeEndpoint, log);

    const itr = pulls(
      (deps.streams.subscribeRepoChange as PulseSource).source({
        repoPath: "/repo",
      }),
    );

    expect((await itr.next()).value).toEqual({ seq: 0 });

    const next = itr.next();
    for (let i = 0; i < 100 && installed.length === 0; i++) await tick();
    expect(installed).toHaveLength(1);

    installed[0]?.();
    expect((await next).value).toEqual({ seq: 1 });
  });

  it("gives each subscription its OWN seq sequence (each starts at 0)", async () => {
    const fakeEndpoint = {
      fs: { subscribeRepoChange: () => () => {} },
    } as unknown as TerminalEndpoint;
    const deps = padiFsGitDeps(fakeEndpoint, log);
    const firstFrame = async (repoPath: string) =>
      (
        await pulls(
          (deps.streams.subscribeRepoChange as PulseSource).source({
            repoPath,
          }),
        ).next()
      ).value;

    expect(await firstFrame("/a")).toEqual({ seq: 0 });
    expect(await firstFrame("/a")).toEqual({ seq: 0 });
  });
});
