/**
 * `SurfaceAppProvider` — the model it hands to `useSurfaceApp()`. Covered here
 * (not in `index.test.ts`) because it pulls in `solid-js` reactive primitives;
 * the pure-kernel suite stays Solid-free. Node env is fine: the provider is
 * built with `createComponent` (no JSX) and driven through the `{ status }`
 * connection source, so there's no DOM, transport, or probe to fake.
 *
 * The focus is `updateReady` — the skew-OR-restart predicate the model owns so
 * consumers read it instead of re-deriving `status() === "restarted" || stale()`.
 */

import {
  type Accessor,
  createComponent,
  createRoot,
  createSignal,
} from "solid-js";
import { describe, expect, it } from "vitest";
import {
  type ConnectionStatus,
  type ControlPlane,
  type SurfaceAppModel,
  SurfaceAppProvider,
  useSurfaceApp,
} from "./index";

/** A `controlPlane` whose `buildInfo` cell yields a fixed server commit. */
function fakeControlPlane(serverCommit: string): ControlPlane {
  return {
    cells: {
      buildInfo: {
        use: () => ({ value: () => ({ commit: serverCommit }) }),
      },
    },
  };
}

/** Mount the provider with a caller-supplied `status` accessor and capture the
 *  model a child reads back out of context. */
function mountModel(opts: {
  serverCommit: string;
  clientCommit: string;
  status: Accessor<ConnectionStatus>;
  dispose: () => void;
}): SurfaceAppModel {
  let captured!: SurfaceAppModel;
  createComponent(SurfaceAppProvider, {
    controlPlane: fakeControlPlane(opts.serverCommit),
    clientCommit: opts.clientCommit,
    status: opts.status,
    get children() {
      captured = useSurfaceApp();
      return null;
    },
  });
  return captured;
}

describe("SurfaceAppProvider — updateReady", () => {
  it("flips on a `restarted` status (deploy caught live), even when not stale", () => {
    createRoot((dispose) => {
      const [status, setStatus] = createSignal<ConnectionStatus>("live");
      // Same commit on both sides → never stale; only the status drives it.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "0784979",
        status,
        dispose,
      });

      expect(model.stale()).toBe(false);
      expect(model.updateReady()).toBe(false);

      setStatus("restarted");
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });

  it("flips on staleness (cached old bundle) while the link is otherwise live", () => {
    createRoot((dispose) => {
      // Two clean refs that disagree → stale, even though status stays `live`.
      const model = mountModel({
        serverCommit: "0784979",
        clientCommit: "abc1234",
        status: () => "live",
        dispose,
      });

      expect(model.status()).toBe("live");
      expect(model.stale()).toBe(true);
      expect(model.updateReady()).toBe(true);

      dispose();
    });
  });
});
