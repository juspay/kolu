import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

async function dropFile(
  world: KoluWorld,
  file:
    | { name: string; content: string; sizeMiB?: never }
    | { name: string; content?: never; sizeMiB: number },
): Promise<void> {
  await world.canvas.click();
  await world.page.evaluate((file) => {
    const target = document.querySelector("[data-focused][data-terminal-id]");
    if (!target) throw new Error("No focused terminal container");
    const bytes =
      "content" in file
        ? file.content
        : new Uint8Array(file.sizeMiB * 1024 * 1024);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name));
    // Inline the two dispatches rather than a `fire(type)` helper:
    // esbuild's keep-names transform decorates inner functions with
    // a `__name(...)` call that doesn't exist inside page.evaluate's
    // browser-side eval context, so a named arrow here would crash.
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
    } as const;
    target.dispatchEvent(new DragEvent("dragover", init));
    target.dispatchEvent(new DragEvent("drop", init));
  }, file);
  // Wait for the upload RPC round trip; the terminal buffer contains
  // the path once the server bracketed-pastes it back.
  await world.waitForFrame();
  await world.waitForFrame();
}

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
    await dropFile(this, { name, content });
  },
);

When(
  "I drop an {int} MiB file named {string} onto the terminal",
  async function (this: KoluWorld, sizeMiB: number, name: string) {
    await dropFile(this, { name, sizeMiB });
  },
);
