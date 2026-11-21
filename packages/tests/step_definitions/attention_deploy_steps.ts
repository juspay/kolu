/**
 * A deploy, and a padi replaced, under a page that stays open — what a
 * person's tab lives through. `the kolu server is redeployed under this page`
 * (attention_alert_steps.ts) is a different event: it kills padi with the
 * server and moves the page to a new address.
 *
 * Each step notes the agent's terminal before it acts, so the check after it
 * can wait for the NEW padi's verdict on that terminal — read off padi itself,
 * then through the server — before anything checks what the page did not do.
 */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import type { PadiIdentity, PadiUrgency } from "@kolu/padi-client/surface";
import {
  deployKoluServer,
  isPidLive,
  killPadiDaemon,
  readKavalGatePid,
  readPadiDirect,
  readPadiGatePid,
} from "../support/hooks.ts";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const agentTerminal = new WeakMap<KoluWorld, string>();

/** The one waiting agent's terminal id, off its dock row. */
async function noteAgentTerminal(world: KoluWorld): Promise<void> {
  const ids = await world.page
    .locator('[data-testid="dock-row"][data-agent-state="waiting"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-terminal-id")),
    );
  const [id] = ids;
  assert.ok(
    ids.length === 1 && id,
    `expected one waiting agent's dock row, found ${JSON.stringify(ids)}`,
  );
  agentTerminal.set(world, id);
}

/** A deploy, with the person at the page: the moment the page offers its
 *  Reload button (kolu's transport overlay, shown when the new server retires
 *  the old page's socket), click it, and wait for the reloaded page to load.
 *  The click races the deploy on purpose — that is what a person does. */
When(
  "kolu is deployed under this page and I click Reload when it is offered",
  { timeout: 240_000 },
  async function (this: KoluWorld) {
    await noteAgentTerminal(this);
    const reload = this.page.locator(
      '[data-testid="transport-overlay"] button',
    );
    const reloaded = async (): Promise<void> => {
      await reload.waitFor({ state: "visible", timeout: 120_000 });
      const loaded = this.page.waitForEvent("load", { timeout: 120_000 });
      await reload.click();
      await loaded;
    };
    await Promise.all([deployKoluServer(), reloaded()]);
  },
);

/** The host's padi is replaced while the server and the page stay as they
 *  are: the harness kills THIS worker's padi (kaval is left), and the running
 *  server's binder starts another, which adopts kaval's terminals. */
When(
  "this host's padi is replaced under the page",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await noteAgentTerminal(this);
    const kavalBefore = readKavalGatePid();
    const killed = killPadiDaemon();
    assert.ok(killed !== undefined, "no padi held this worker's gate");
    await pollFor({
      observe: async () => readPadiGatePid(),
      isDone: (pid) => pid !== undefined && pid !== killed && isPidLive(pid),
      timeoutMs: 60_000,
      intervalMs: 100,
      onTimeout: (pid, ms) =>
        new Error(
          `after ${ms}ms no new padi held the gate (killed ${killed}, gate holds ${pid})`,
        ),
    });
    assert.strictEqual(
      readKavalGatePid(),
      kavalBefore,
      "kaval was replaced: the terminals did not survive",
    );
  },
);

/** padi's own verdict on the noted agent, after the step that replaced padi:
 *  read off the new padi until it is settled and lists the agent finished;
 *  then through the server, once the server's link is to that same padi (its
 *  `identity` carries the new padi's start time), so the page — which reads
 *  through the server too — has been told. */
Then(
  "padi should list the agent's turn as finished",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = agentTerminal.get(this);
    assert.ok(id, "no agent's terminal was noted before padi was replaced");
    const finished = (urgency: PadiUrgency): boolean =>
      urgency.settled && urgency.finishedIds.includes(id);
    const direct = await pollFor({
      observe: () =>
        readPadiDirect().catch((err: unknown) =>
          err instanceof Error ? err : new Error(String(err)),
        ),
      isDone: (read) => !(read instanceof Error) && finished(read.urgency),
      timeoutMs: POLL_TIMEOUT,
      intervalMs: 100,
      onTimeout: (last, ms) =>
        new Error(
          `after ${ms}ms padi had not listed ${id} finished (last read: ${
            last instanceof Error ? last.message : JSON.stringify(last?.urgency)
          })`,
        ),
    });
    assert.ok(!(direct instanceof Error));
    await waitForPadiCell({
      memberVerb: "identity/get",
      accept: (value) =>
        (value as PadiIdentity).startedAt === direct.identity.startedAt,
      what: `the new padi's identity (started at ${direct.identity.startedAt})`,
      timeoutMs: POLL_TIMEOUT,
    });
    await waitForPadiCell({
      memberVerb: "urgency/get",
      accept: (value) => finished(value as PadiUrgency),
      what: `${id} finished`,
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
