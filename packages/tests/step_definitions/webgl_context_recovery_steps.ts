import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** The visible terminal's container (carries `__xterm` + `data-renderer`). Used
 *  over `[data-focused]` because clicking the settings popover blurs the terminal,
 *  dropping `data-focused` while `data-visible` persists. */
const VISIBLE_TERMINAL = "[data-visible][data-terminal-id]";

When(
  "the focused terminal's WebGL context is lost and restored",
  async function (this: KoluWorld) {
    await this.page.evaluate(async (sel) => {
      const el = document.querySelector(sel);
      const term = (el as unknown as { __xterm?: { element?: HTMLElement } })
        ?.__xterm;
      // xterm appends the LinkRenderLayer's 2D canvas (`.xterm-link-layer`) BEFORE
      // its own WebGL canvas, so exclude it — the same selector attachWebGL uses.
      const canvas = term?.element?.querySelector<HTMLCanvasElement>(
        ".xterm-screen canvas:not(.xterm-link-layer)",
      );
      if (!canvas) throw new Error("no WebGL canvas on the focused terminal");
      // Tag the pre-loss canvas so the assertion can prove the kit REPLACED it: a
      // re-init disposes the stale addon (removing its canvas) and appends a fresh
      // one. Current (unfixed) code leaves this tagged canvas in place.
      canvas.setAttribute("data-pin-preloss", "1");
      const lose = canvas
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      if (!lose) throw new Error("WEBGL_lose_context unavailable");
      // Model a Chrome eviction+restore: loseContext fires `webglcontextlost` (the
      // kit preventDefaults it, opting into restore) then restoreContext fires
      // `webglcontextrestored` (the kit re-inits). The events dispatch as async
      // tasks, so let the loss settle before restoring.
      lose.loseContext();
      await new Promise((r) => setTimeout(r, 50));
      lose.restoreContext();
    }, VISIBLE_TERMINAL);
  },
);

Then(
  "the focused terminal re-initializes its WebGL renderer on a fresh, live context",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        const term = (el as unknown as { __xterm?: { element?: HTMLElement } })
          ?.__xterm;
        const canvas = term?.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        );
        if (!canvas) return false;
        // The re-init must have replaced the pre-loss canvas — a fresh, untagged
        // element — and its context must be live (not the dead one it replaced).
        // Unfixed code never re-inits, so the tagged canvas persists → timeout.
        if (canvas.getAttribute("data-pin-preloss") === "1") return false;
        const gl = canvas.getContext("webgl2");
        return !!gl && !gl.isContextLost();
      },
      VISIBLE_TERMINAL,
      { timeout: POLL_TIMEOUT },
    );
  },
);
