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
    // allow generous time) → reattach → `connected`. The daemonStatus flips and
    // the DegradedCanvas unmounts. Detachment IS the recovery proof.
    await this.page.waitForSelector('[data-testid="degraded-canvas"]', {
      state: "detached",
      timeout: 45_000,
    });
  },
);
