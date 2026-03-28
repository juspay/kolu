import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

/** Read terminal ID from the visible terminal container element. */
async function getVisibleTerminalId(world: KoluWorld): Promise<string> {
  const id = await world.page
    .locator("[data-visible][data-terminal-id]")
    .getAttribute("data-terminal-id");
  if (!id) throw new Error("No visible terminal found");
  return id;
}

Then(
  "the screenText API should return text containing {string}",
  async function (this: KoluWorld, expected: string) {
    await pollUntilBufferContains(this.page, expected);

    const id = await getVisibleTerminalId(this);
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
