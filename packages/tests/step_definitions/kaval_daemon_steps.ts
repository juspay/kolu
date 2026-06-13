/**
 * Steps for the kaval daemon lifecycle (B2 — the door).
 *
 * "Killing kaval mid-session" SIGKILLs the daemon the worker's server spawned
 * (via the gate it wrote), simulating a `pkill kaval`. The server's supervisor
 * endpoint sees the socket close, flips to `degraded`, and publishes it on the
 * `daemonStatus` surface — which drives the client's DegradedCanvas. The test
 * asserts that honest surface appears, not the empty-state welcome.
 */

import { Then, When } from "@cucumber/cucumber";
import { killKavalDaemon } from "../support/hooks.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("the kaval daemon is killed", async function (this: KoluWorld) {
  const pid = killKavalDaemon();
  if (pid === undefined) {
    throw new Error(
      "no kaval daemon to kill — the server should have spawned one at boot",
    );
  }
});

Then("the degraded canvas is shown", async function (this: KoluWorld) {
  // The socket close → endpoint `degraded` → daemonStatus collection →
  // DegradedCanvas. Distinct from the empty-state `canvas-container`.
  await this.page.waitForSelector('[data-testid="degraded-canvas"]', {
    timeout: POLL_TIMEOUT,
  });
});

When(
  "I click restart kaval on the degraded canvas",
  async function (this: KoluWorld) {
    // The B3 one-click affordance — fires the `daemon.restart` RPC over the live
    // client↔server WS (the SERVER is still up; only the daemon died).
    await this.page.click('[data-testid="degraded-restart"]');
  },
);

Then(
  "kaval reconnects and the degraded canvas clears",
  async function (this: KoluWorld) {
    // restart → capture → recycle (spawn a fresh daemon: a tsx cold start, so
    // allow generous time) → reattach → `connected`. The supervisor holds the
    // daemon at `restarting` (the inner `connecting` is coalesced) so the
    // degraded canvas stays up THROUGH the whole recycle and only detaches once
    // kaval is actually `connected` again — so detachment alone no longer races
    // ahead of reconnection. Assert detachment, THEN prove the daemon is truly
    // back by waiting for the healthy canvas surface to mount (a `connected`
    // daemon serving the empty/restore canvas), not just that the degraded card
    // went away.
    await this.page.waitForSelector('[data-testid="degraded-canvas"]', {
      state: "detached",
      timeout: 45_000,
    });
    await this.page.waitForSelector('[data-testid="canvas-container"]', {
      timeout: 15_000,
    });
  },
);
