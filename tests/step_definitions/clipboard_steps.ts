import { When } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";

/**
 * Upload a small test image (4-byte PNG-like payload) to the active terminal
 * via the pasteImage RPC endpoint. The shim scripts will serve this data
 * when xclip/wl-paste are called inside the PTY.
 */
When(
  "I upload a test image to the active terminal",
  async function (this: KoluWorld) {
    const container = this.page.locator("[data-visible][data-terminal-id]");
    const rawId = await container.getAttribute("data-terminal-id");
    if (!rawId) throw new Error("No active terminal found");

    // 4 bytes of test data so "wc -c" returns "4"
    const base64Data = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString("base64");

    const resp = await this.page.request.fetch("/rpc/terminal/pasteImage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { id: Number(rawId), data: base64Data } }),
    });
    if (!resp.ok()) {
      throw new Error(
        `pasteImage RPC failed: ${resp.status()} ${await resp.text()}`,
      );
    }
  },
);
