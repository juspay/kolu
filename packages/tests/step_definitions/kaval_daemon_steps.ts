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
