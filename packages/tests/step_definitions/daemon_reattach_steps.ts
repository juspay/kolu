import { When } from "@cucumber/cucumber";
import { restartKoluServer } from "../support/hooks.ts";
import type { KoluWorld } from "../support/world.ts";

/** Restart kolu-server while leaving the detached `kolu --stdio` PTY-host
 *  daemon running — the reattach test's core action. The client's WebSocket
 *  drops when the old server dies and auto-reconnects to the fresh one, whose
 *  boot-time `reattachLocalTerminals` has already re-registered the surviving
 *  PTYs and started a fresh provider DAG against them. */
When("I restart the kolu server", async function (this: KoluWorld) {
  await restartKoluServer();
});
