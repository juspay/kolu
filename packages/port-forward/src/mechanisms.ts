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
import { openSshForward, spawnSshChild } from "./sshForward.ts";

export function nativeMechanisms(): ForwardMechanisms {
  return {
    open(target, onLost) {
      return target.kind === "local"
        ? openRelay(target.port, onLost)
        : openSshForward(target.host, target.port, onLost, spawnSshChild);
    },
  };
}
