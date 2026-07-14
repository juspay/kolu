import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Window globals the probe installs to observe the atlas rebuild. `__atlasClears`
 *  counts every `WebglRenderer.clearTextureAtlas()` call after the probe is armed —
 *  the exact call the fix's on-show `clearAtlas()` triggers. */
interface AtlasProbeWindow {
  __atlasClears?: number;
  __atlasProbeArmed?: boolean;
}

When("I arm the WebGL atlas-rebuild probe", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    // Wrap clearTextureAtlas on the WebGL renderer's PROTOTYPE (not an instance)
    // so it survives a context churn — a tile that unloads/reloads its WebGL
    // context on hide/show gets a fresh renderer instance sharing this prototype.
    const els = Array.from(document.querySelectorAll("[data-terminal-id]"));
    let proto: { clearTextureAtlas?: (...a: unknown[]) => unknown } | null =
      null;
    type Rndr = { clearTextureAtlas?: (...a: unknown[]) => unknown };
    for (const el of els) {
      // xterm's RenderService holds `_renderer` as a MutableDisposable, so the
      // real WebglRenderer (which owns clearTextureAtlas — the call the addon's
      // clearTextureAtlas, and thus the fix, delegates to) is `_renderer.value`.
      const holder = (
        el as unknown as {
          __xterm?: {
            _core?: {
              _renderService?: { _renderer?: Rndr & { value?: Rndr } };
            };
          };
        }
      ).__xterm?._core?._renderService?._renderer;
      const renderer: Rndr | undefined = holder?.value ?? holder;
      if (renderer && typeof renderer.clearTextureAtlas === "function") {
        proto = Object.getPrototypeOf(renderer);
        break;
      }
    }
    if (!proto || typeof proto.clearTextureAtlas !== "function") {
      throw new Error("no WebGL renderer found to arm the atlas probe");
    }
    const w = window as unknown as AtlasProbeWindow;
    if (!w.__atlasProbeArmed) {
      const orig = proto.clearTextureAtlas;
      // Array element keeps the replacement anonymous — a NAME-INFERRED
      // assignment gets an esbuild `__name(...)` call that crashes in
      // page.evaluate (see render_recovery_steps.ts).
      const wrap = [
        function (this: unknown, ...args: unknown[]) {
          w.__atlasClears = (w.__atlasClears ?? 0) + 1;
          return orig.apply(this, args);
        },
      ];
      proto.clearTextureAtlas = wrap[0];
      w.__atlasProbeArmed = true;
    }
    // Reset so only rebuilds AFTER arming (the switch-back below) count.
    w.__atlasClears = 0;
  });
});

Then(
  "the shown sub-terminal's WebGL atlas is rebuilt",
  async function (this: KoluWorld) {
    // The fix forces clearTextureAtlas on the per-tile visible transition even
    // when cols/rows are unchanged (the sub-tab switch is same-geometry, so the
    // fit is a no-op — the escape hatch). Unfixed code never rebuilds here, so the
    // counter stays 0 and this times out.
    await this.page.waitForFunction(
      () => ((window as unknown as AtlasProbeWindow).__atlasClears ?? 0) >= 1,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
