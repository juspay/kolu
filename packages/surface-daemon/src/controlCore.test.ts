import { describe, expect, it, vi } from "vitest";
import { directLink } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import {
  CONTROL_CORE_VERSION,
  controlCoreFragment,
  controlCoreSurface,
} from "./controlCore.ts";

describe("controlCoreFragment", () => {
  it("serves the frozen identity fields and awaits the drain hook", async () => {
    const onDrain = vi.fn(async () => {});
    const runtime = implementSurface(
      controlCoreSurface,
      controlCoreFragment({
        stateRoot: "/state/pulse",
        surfaceVersion: "3.2",
        startedAt: 42,
        commit: "deadbee",
        buildId: "build-7",
        onDrain,
      }),
    );
    const client = directLink<typeof controlCoreSurface.contract>(
      runtime.router as never,
    );
    await expect(client.surface.core.hello()).resolves.toEqual({
      stateRoot: "/state/pulse",
      surfaceVersion: "3.2",
      controlCoreVersion: CONTROL_CORE_VERSION,
      startedAt: 42,
      commit: "deadbee",
      buildId: "build-7",
    });
    await client.surface.core.drain();
    expect(onDrain).toHaveBeenCalledOnce();
    await runtime.close();
  });
});
