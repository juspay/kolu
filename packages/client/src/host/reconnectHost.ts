/** Atomic "force-cycle this host's connector" verb — shared by the host-down
 *  canvas recovery button and the diagnostics popover's retry row so deadline
 *  reset + toast wording cannot drift. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import { resetBootDeadline } from "../kaval/bootDeadline";
import { client } from "../wire";
import { hostLabel } from "./hostChipTone";

export function reconnectHost(host: HostKey): void {
  client.hosts
    .reconnect({ host })
    .then(() => resetBootDeadline(encodeHostKey(host)))
    .catch((err: Error) =>
      toast.error(`Couldn't reconnect ${hostLabel(host)}: ${err.message}`),
    );
}
