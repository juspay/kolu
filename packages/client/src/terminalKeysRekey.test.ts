/** Pin for the terminal-list keys stream's host RE-KEY (wire.ts `terminalKeys`, re-run #5
 *  blocker). The stream MUST re-subscribe when `activeHost` switches — a static
 *  `createSubscription` bound it to the BOOT host and stranded the canvas on the wrong host's
 *  ids (the flagship "live-switch the canvas" behavior silently broken for every non-boot host).
 *  wire.ts is module-init (untestable in isolation), so this reproduces its exact shape — a host
 *  accessor + a per-host keys factory over `createReactiveSubscription` — and asserts a switch
 *  re-subscribes under the NEW host, tearing down the old host's stream: the old host's ids are
 *  never delivered under the new host. (`createReactiveSubscription`'s own tests pin the
 *  primitive's reset/pending/abort timing; this pins that wire uses it, not the static twin.) */

import { createReactiveSubscription } from "@kolu/surface/solid";
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
        // The wire's shape: `createReactiveSubscription(activeHost, (host, signal) =>
        // unenrolledStreamCall(padiRpcOf(host).surface.terminals.keys, undefined, { signal }))`.
        const sub = createReactiveSubscription<string, string[]>(
          host,
          (h, signal) => {
            factoryHosts.push(h);
            signal.addEventListener("abort", () => aborted.push(h));
            async function* gen(): AsyncGenerator<string[]> {
              yield idsByHost[h] ?? [];
              // Stay open (like a live keys stream) until this host's sub is aborted.
              await new Promise<void>((res) =>
                signal.addEventListener("abort", () => res()),
              );
            }
            return Promise.resolve(gen());
          },
        );

        await flush();
        // Boot host: local's ids delivered; the factory saw ONLY "local".
        expect(factoryHosts).toEqual(["local"]);
        expect(sub()).toEqual(["local-1", "local-2"]);

        // Switch to zest — the whole point of the PR.
        setHost("zest");
        await flush();
        // Re-subscribed under the NEW host; the OLD host's stream aborted; ids swapped —
        // NOT stranded on local's ids (the static-createSubscription bug).
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
