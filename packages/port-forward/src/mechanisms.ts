/**
 * The real mechanisms, chosen by target kind — the one place the "three cases"
 * table becomes code. `remote` goes through ssh on a shared master; `local` is
 * a TCP relay on this machine. (The third case, a port already bound to
 * `0.0.0.0`, needs no forward and never reaches here.)
 */

import type { ForwardMechanisms } from "./opened.ts";
import { openRelay } from "./relay.ts";
import { createSshForwards } from "./sshForward.ts";

export function nativeMechanisms(): ForwardMechanisms {
  // One ssh side per manager, because it owns the per-host anchors that keep
  // the shared masters alive for as long as this process holds a forward.
  const ssh = createSshForwards();
  return {
    open(target, onLost) {
      return target.kind === "local"
        ? openRelay(target.port, onLost)
        : ssh.open(target.host, target.port, onLost);
    },
  };
}
