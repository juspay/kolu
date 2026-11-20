import { createReactiveSubscription } from "@kolu/surface/solid";
import { Effect, Stream } from "effect";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("terminalKeys re-keys on host switch (re-run #5 blocker)", () => {
  it("a switch re-subscribes under the new host; the old host's ids are gone + its stream aborts", async () => {
    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const [host, setHost] = createSignal<string>("local");
        const factoryHosts: string[] = [];
        const aborted: string[] = [];
        const idsByHost: Record<string, string[]> = {
          local: ["local-1", "local-2"],
          zest: ["zest-1"],
        };
        const sub = createReactiveSubscription<string, string[]>(host, (h) => {
          factoryHosts.push(h);
          return Stream.ensuring(
            Stream.concat(Stream.succeed(idsByHost[h] ?? []), Stream.never),
            Effect.sync(() => aborted.push(h)),
          );
        });

        await flush();
        expect(factoryHosts).toEqual(["local"]);
        expect(sub()).toEqual(["local-1", "local-2"]);

        setHost("zest");
        await flush();
        expect(factoryHosts).toEqual(["local", "zest"]);
        expect(aborted).toContain("local");
        expect(sub()).toEqual(["zest-1"]);
        expect(sub()).not.toEqual(["local-1", "local-2"]);

        resolve();
        dispose();
      });
    });
  });
});
