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
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

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

// B3.2 — the supervised restart. The degraded canvas' "Restart kaval" button
// fires `daemon.restart`: capture the session, drain, recycle (spawn fresh +
// connect). The same button lives in the kaval rail dialog for a running daemon.
When(
  "I restart kaval from the degraded canvas",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="restart-kaval"]').click();
  },
);

// B3.2 / F3 — while the recycle is in flight the supervisor holds `restarting`,
// and the drain empties the terminal list. The canvas must render the neutral
// warming surface, NOT the empty-state welcome with its enabled Restore +
// new-terminal affordances (which would let a click spawn/restore terminals into
// the daemon the recycle is about to kill). A fresh-daemon spawn under CI load is
// slow, so the `restarting` window is reliably observable.
Then(
  "the warming canvas is shown while kaval restarts",
  async function (this: KoluWorld) {
    await this.page.waitForSelector('[data-testid="daemon-warming"]', {
      timeout: POLL_TIMEOUT,
    });
  },
);

Then(
  "the restore card is not offered until kaval is connected",
  async function (this: KoluWorld) {
    // The gate's invariant: while the warming surface is up (the daemon is not
    // yet `connected`), the empty-state restore card is absent — terminal
    // creation/restore must wait for `connected`. Read both in ONE DOM snapshot
    // so a flip-to-connected between two reads can't make this flake: the assert
    // only fires when warming is STILL present, and the restore card is too.
    const leaked = await this.page.evaluate(() => {
      const warming = document.querySelector('[data-testid="daemon-warming"]');
      const restore = document.querySelector('[data-testid="restore-session"]');
      return Boolean(warming && restore);
    });
    if (leaked) {
      throw new Error(
        "restore card was reachable while kaval was still warming — it must " +
          "be gated until the daemon is connected (F3)",
      );
    }
  },
);

// B3.2 / F3 — the warming gate must cover the keyboard/palette create path, not
// just the EmptyState/Dock affordances the canvas hides. The create shortcut
// (`Cmd+T` / `Cmd+Enter`) stays live over the neutral warming surface, so without
// the `useTerminalCrud.handleCreate` guard a keypress would call
// `client.terminal.create` against the daemon the recycle is about to kill. Press
// the shortcut, then assert in ONE DOM snapshot: if the warming surface is STILL
// up (so `daemonWarming()` was true) no `canvas-tile` may have appeared — the
// shared create chokepoint must have refused.
When(
  "I press the create terminal shortcut while kaval restarts",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${MOD_KEY}+t`);
  },
);

Then(
  "no terminal is created while kaval is warming",
  async function (this: KoluWorld) {
    const leaked = await this.page.evaluate(() => {
      const warming = document.querySelector('[data-testid="daemon-warming"]');
      const tile = document.querySelector('[data-testid="canvas-tile"]');
      return Boolean(warming && tile);
    });
    if (leaked) {
      throw new Error(
        "a terminal was created via the keyboard shortcut while kaval was " +
          "still warming — the create chokepoint must refuse until the " +
          "daemon is connected (F3)",
      );
    }
  },
);

Then("the daemon returns to running", async function (this: KoluWorld) {
  // The recycle spawns a FRESH daemon (the dead one's stale gate is reaped by
  // its `acquirePidGate`), so the supervisor's endpoint reports `connected`
  // again on the rail. A fresh spawn under CI load can be slow — be generous.
  await this.page.waitForSelector('[data-daemon-state="connected"]', {
    timeout: 45_000,
  });
});
