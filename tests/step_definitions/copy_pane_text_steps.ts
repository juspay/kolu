import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

/** Fetch the active terminal ID from the sidebar. */
async function getActiveTerminalId(world: KoluWorld): Promise<string> {
  const id = await world.page
    .locator("[data-testid='sidebar'] [data-active][data-terminal-id]")
    .getAttribute("data-terminal-id");
  if (!id) throw new Error("No active terminal found in sidebar");
  return id;
}

Then(
  "the screenText API should return text containing {string}",
  async function (this: KoluWorld, expected: string) {
    // Wait for the buffer to contain the text first
    await pollUntilBufferContains(this.page, expected);

    // Call the screenText RPC endpoint directly via HTTP
    const id = await getActiveTerminalId(this);
    const resp = await this.page.request.fetch("/rpc/terminal/screenText", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { id } }),
    });
    const body = await resp.json();
    const text = (body.json ?? body) as string;
    assert.ok(
      text.includes(expected),
      `screenText response does not contain "${expected}".\nGot (first 500 chars): ${text.slice(0, 500)}`,
    );
  },
);

Then(
  "a toast should appear with text {string}",
  async function (this: KoluWorld, expected: string) {
    // solid-sonner renders toasts as <li> inside an <ol> with data-sonner-toaster
    const toast = this.page.locator(`[data-sonner-toaster] li`).filter({
      hasText: expected,
    });
    await toast.first().waitFor({ state: "visible", timeout: 5000 });
  },
);
