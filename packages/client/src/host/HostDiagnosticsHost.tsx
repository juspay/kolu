import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import { type Component, createEffect, Show } from "solid-js";
import { HostDiagnosticsPopover } from "./HostDiagnosticsPopover";
import { hostKeys } from "../wire";
import {
  closeHostDiagnostics,
  hostDiagnosticsAnchor,
  openHostDiagnosticsKey,
} from "./useHostDiagnosticsOpen";

const HostDiagnosticsHost: Component = () => {
  createEffect(() => {
    const key = openHostDiagnosticsKey();
    if (key === null) return;
    const stillMember = hostKeys().some((host) => encodeHostKey(host) === key);
    if (!stillMember) closeHostDiagnostics();
  });
  return (
    <Show when={openHostDiagnosticsKey()} keyed>
      {(key) => (
        <HostDiagnosticsPopover
          host={decodeHostKey(key)}
          triggerRef={hostDiagnosticsAnchor}
          open={() => true}
          onDismiss={closeHostDiagnostics}
        />
      )}
    </Show>
  );
};

export default HostDiagnosticsHost;
