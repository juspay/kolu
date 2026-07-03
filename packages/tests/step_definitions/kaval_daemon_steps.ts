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
import {
  isPidLive,
  killKavalDaemon,
  readKavalGatePid,
  readPadiGatePid,
} from "../support/hooks.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

When("the kaval daemon is killed", async function (this: KoluWorld) {
  const pid = killKavalDaemon();
  if (pid === undefined) {
    throw new Error(
      "no kaval daemon to kill — the server should have spawned one at boot",
    );
  }
});

// The "recycles kaval, not padi" proof. Capture BOTH gate pids before the
// restart; the arms below assert the kaval pid CHANGED (recycled) while the padi
// pid stayed put (padi never restarts — `recycleKaval` is its internal
// supervisory op, distinct from the `control.drain` padi-upgrade path).
When(
  "I capture the padi and kaval daemon pids",
  async function (this: KoluWorld) {
    this.capturedPadiPid = readPadiGatePid();
    this.capturedKavalPid = readKavalGatePid();
    if (this.capturedPadiPid === undefined) {
      throw new Error(
        "no padi gate pid to capture — the server should have spawned padi at boot",
      );
    }
  },
);

// Open the kaval rail chip's info dialog, where the "Restart kaval" button lives
// for a RUNNING (not degraded) daemon — the live-but-stuck arm's entry point.
When("I open the kaval rail dialog", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="kaval-identity-chip"]').click();
  await this.page.waitForSelector('[data-testid="restart-kaval"]', {
    timeout: POLL_TIMEOUT,
  });
});

// The same session-preserving Restart the degraded canvas fires, reached from the
// rail dialog for a live daemon: click the button, then confirm through the
// inline destructive-action guard.
When("I restart kaval from the rail dialog", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="restart-kaval"]').click();
  await this.page.locator('[data-testid="restart-kaval-confirm"]').click();
});

Then(
  "the kaval daemon has been recycled with a fresh pid",
  async function (this: KoluWorld) {
    if (this.capturedKavalPid === undefined) {
      throw new Error(
        "no captured kaval pid — run 'I capture the padi and kaval daemon pids' first",
      );
    }
    // The gate reads the fresh kaval's pid once it has claimed it; the recycle
    // rewrites it, so poll until it differs from the captured one (or timeout).
    let current: number | undefined;
    const deadline = Date.now() + POLL_TIMEOUT;
    do {
      current = readKavalGatePid();
      if (current !== undefined && current !== this.capturedKavalPid) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
    if (current === undefined || current === this.capturedKavalPid) {
      throw new Error(
        `kaval was NOT recycled — gate pid is still ${String(current)} ` +
          `(captured ${this.capturedKavalPid}); a stuck-but-alive kaval must be ` +
          "killed + respawned, not adopted",
      );
    }
    if (!isPidLive(current)) {
      throw new Error(
        `the recycled kaval's gate pid ${current} names no live process`,
      );
    }
  },
);

Then("the padi daemon pid is unchanged", async function (this: KoluWorld) {
  if (this.capturedPadiPid === undefined) {
    throw new Error(
      "no captured padi pid — run 'I capture the padi and kaval daemon pids' first",
    );
  }
  const current = readPadiGatePid();
  if (current !== this.capturedPadiPid) {
    throw new Error(
      `padi was restarted (gate pid ${String(current)} != captured ` +
        `${this.capturedPadiPid}) — recycleKaval must recycle KAVAL, not padi`,
    );
  }
  if (!isPidLive(this.capturedPadiPid)) {
    throw new Error(
      `padi gate pid ${this.capturedPadiPid} names no live process — padi ` +
        "must stay up across a kaval recycle",
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

// W2.2 — the supervised restart. The degraded canvas' "Restart kaval" button
// fires padi's `lifecycle.recycleKaval` procedure: capture the session, drain,
// recycle (spawn fresh + connect) — padi itself stays up. The same button lives
// in the kaval rail dialog for a running daemon. Restart is destructive (kills
// the daemon + every terminal), so the button opens an inline confirm first —
// click through both.
When(
  "I restart kaval from the degraded canvas",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="restart-kaval"]').click();
    await this.page.locator('[data-testid="restart-kaval-confirm"]').click();
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
