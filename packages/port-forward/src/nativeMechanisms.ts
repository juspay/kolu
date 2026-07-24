/**
 * The real mechanisms, chosen by target kind — the one place the "three cases"
 * table becomes code. `remote` gets its OWN ssh connection per forward (see
 * `sshForward.ts` for why a shared master cannot give the lifetime this needs);
 * `local` is a TCP relay on this machine. (The third case, a port already bound
 * to `0.0.0.0`, needs no forward and never reaches here.)
 */

import type { ForwardMechanisms } from "./mechanism.ts";
import { openRelay } from "./relay.ts";
import { openSshForward, spawnSshChild } from "./sshForward.ts";

export function nativeMechanisms(): ForwardMechanisms {
  return {
    open(target, report) {
      return target.kind === "local"
        ? openRelay(target.port, report)
        : openSshForward(target.host, target.port, report, spawnSshChild);
    },
  };
}
