/**
 * The real mechanisms, chosen by target kind — the one place the "three cases"
 * table becomes code. `remote` gets its OWN ssh connection per forward
 * (`ControlPath=none`: no master is shared and none is created, because that
 * connection IS the forward's lifetime); `local` is a TCP relay on this
 * machine. (The third case, a port already bound to `0.0.0.0`, needs no forward
 * and never reaches here.)
 */

import type { ForwardMechanisms } from "./opened.ts";
import { openRelay } from "./relay.ts";
import { createSshForwards } from "./sshForward.ts";

export function nativeMechanisms(): ForwardMechanisms {
  // One ssh side per manager. It holds no state across forwards — each one is
  // its own process — so this is about keeping the argv in one place, not about
  // sharing anything between them.
  const ssh = createSshForwards();
  return {
    open(target, onLost) {
      return target.kind === "local"
        ? openRelay(target.port, onLost)
        : ssh.open(target.host, target.port, onLost);
    },
  };
}
