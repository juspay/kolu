import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

/**
 * Simulate a real file drop on the terminal container. Construct a
 * `DataTransfer` with a synthetic `File`, then dispatch the
 * dragover/drop sequence Chrome would emit. The terminal's drop
 * listener uploads via oRPC; the server saves the file and bracketed-
 * pastes the path into the PTY, so the file's name shows up in the
 * screen buffer once the round trip completes.
 */
When(
  "I drop a file named {string} with content {string} onto the terminal",
  async function (this: KoluWorld, name: string, content: string) {
    await this.canvas.click();
    await this.page.evaluate(
      ({ name, content }) => {
        const target = document.querySelector(
          "[data-focused][data-terminal-id]",
        );
        if (!target) throw new Error("No focused terminal container");
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type: "text/plain" }));
        const fire = (type: string) =>
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: dt,
            }),
          );
        fire("dragover");
        fire("drop");
      },
      { name, content },
    );
    // Wait for the upload RPC round trip; the terminal buffer contains
    // the path once the server bracketed-pastes it back.
    await this.waitForFrame();
    await this.waitForFrame();
  },
);
