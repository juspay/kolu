import * as assert from "node:assert";
import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Assert the active tile carries the P3 host chip naming a remote machine.
 *
 *  The chip (`data-testid="terminal-host-chip"`) renders ONLY for a remote
 *  terminal — its absence is the "local" signal. It appears with the sync-shadow
 *  tile the dial creates (so it is visible the instant `terminal.create`
 *  returns), names the machine, and carries that host's projected daemon state
 *  in `data-host-state` (provisioning → connected). Scope to the active tile —
 *  the just-dialed terminal is set active by `handleCreate`. */
Then(
  "the active terminal should show host chip {string}",
  async function (this: KoluWorld, hostId: string) {
    const chip = this.page.locator(
      '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-host-chip"]',
    );
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const label = (await chip.textContent())?.trim();
    assert.ok(
      label?.includes(hostId),
      `Expected the host chip to name "${hostId}", got "${label}"`,
    );
  },
);
